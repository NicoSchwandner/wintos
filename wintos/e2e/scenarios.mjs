// Interaction checks against the running WintOS dev instance (wintos/dev-instance.sh, debug port
// 9224): real key events over CDP, assertions on the DOM of each renderer. Never point this at the
// everyday instance; its keystrokes would land in the developer's window.
// usage: node wintos/e2e/scenarios.mjs
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";

const PORT = process.env.WINTOS_DEBUG_PORT ?? 9224;
if (String(PORT) === "9223") throw new Error("9223 is the everyday instance; scenarios only run against the dev instance");
const DB = `${homedir()}/.local/share/wintos-dev/data/db/waveterm.db`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function renderers() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    return list.filter((t) => t.type === "page" && t.url.includes("index.html"));
}

async function cdp(t, method, params = {}) {
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener("open", r));
    const res = await new Promise((r) => {
        ws.addEventListener("message", (m) => r(JSON.parse(m.data)));
        ws.send(JSON.stringify({ id: 1, method, params }));
    });
    ws.close();
    return res.result;
}

const evalIn = async (t, expression) => (await cdp(t, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }))?.result?.value;

// The window's active tab, from the dev instance's own database, and its renderer: page
// visibility can't tell, since a window behind another reports hidden.
// Right after a start or a switch the active tab's renderer may still be loading, so wait for it.
async function visible() {
    return until("the active tab's renderer", async () => {
        const active = sql(`select data->>'activetabid' from db_workspace limit 1`);
        for (const t of await renderers()) if ((await evalIn(t, "window.wintosTabId?.()")) === active) return t;
        return false;
    });
}

// CDP's synthetic keys go to whatever holds focus; inside a page they skip the main-process
// forwarding a real keypress goes through, and an element's .focus() leaves the page holding it.
// So WintOS keys are pressed after CDP's own DOM.focus on the Inbox list, else the document body.
async function focusOut(t) {
    if (await evalIn(t, "document.hasFocus() && document.activeElement?.tagName !== 'WEBVIEW'")) return;
    await cdpFocus(t, "[data-wintos=inbox-list]", "body");
}

// Real focus through CDP on the first selector that matches; node ids live per session.
async function cdpFocus(t, ...selectors) {
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener("open", r));
    let id = 0;
    const call = (method, params = {}) =>
        new Promise((r) => {
            const n = ++id;
            ws.addEventListener("message", function on(m) {
                const d = JSON.parse(m.data);
                if (d.id === n) (ws.removeEventListener("message", on), r(d.result));
            });
            ws.send(JSON.stringify({ id: n, method, params }));
        });
    const { root } = await call("DOM.getDocument");
    for (const selector of selectors) {
        const found = await call("DOM.querySelector", { nodeId: root.nodeId, selector });
        if (found?.nodeId) {
            await call("DOM.focus", { nodeId: found.nodeId });
            break;
        }
    }
    ws.close();
}

// modifiers: Alt 1, Ctrl 2, Meta 4, Shift 8 (CDP's bitmask).
const MODS = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
async function press(t, key, { code, keyCode, mods = [] } = {}) {
    const modifiers = mods.reduce((m, k) => m | MODS[k], 0);
    if (modifiers) await focusOut(t);
    const base = { key, code: code ?? (key.length === 1 ? `Key${key.toUpperCase()}` : key), windowsVirtualKeyCode: keyCode ?? key.toUpperCase().charCodeAt(0), modifiers };
    await cdp(t, "Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
    await cdp(t, "Input.dispatchKeyEvent", { type: "keyUp", ...base });
    // A held ⌘ ends with its own release, which the project switcher waits for.
    if (mods.includes("meta")) await cdp(t, "Input.dispatchKeyEvent", { type: "keyUp", key: "Meta", code: "MetaLeft", windowsVirtualKeyCode: 91 });
}

// A project whose renderer is not cached yet takes a while to appear after a restart.
async function until(what, fn, ms = 15000) {
    const end = Date.now() + ms;
    for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
        await sleep(200);
    }
}

const inboxIn = (t) => evalIn(t, `!!document.querySelector("[data-wintos=inbox]")`);
const sql = (q) => execFileSync("sqlite3", ["-readonly", DB, q], { encoding: "utf8" }).trim();
const results = [];
async function scenario(name, fn) {
    try {
        await fn();
        results.push(["PASS", name]);
    } catch (e) {
        results.push(["FAIL", name, e.message]);
    }
}

async function toProject() {
    // ⌘J walks the cards too, so from PRs it may land on On call first.
    let t = await visible();
    for (let i = 0; i < 3 && (await inboxIn(t)); i++) {
        await press(t, "j", { mods: ["meta"] });
        await sleep(1500);
        t = await visible();
    }
    return until("a project in front", async () => ((t = await visible()), !(await inboxIn(t)) && t));
}

// The dev window usually sits behind the developer's own windows, and it must stay there: a
// covered window is neither focused nor visible, so focus handoffs stall. Focus emulation makes
// each renderer behave as if in front; it lasts while its CDP session stays open, so hold one per
// renderer for the whole run.
const held = new Set();
async function holdFocus() {
    for (const t of await renderers()) {
        if (held.has(t.id)) continue;
        const ws = new WebSocket(t.webSocketDebuggerUrl);
        await new Promise((r) => ws.addEventListener("open", r));
        ws.send(JSON.stringify({ id: 1, method: "Emulation.setFocusEmulationEnabled", params: { enabled: true } }));
        held.add(t.id);
    }
}
await holdFocus();
const heldTimer = setInterval(holdFocus, 1000); // renderers created during the run

// Every run starts with at least one project (the dev-only wintosAction hook creates one).
const projects = () => Number(sql(`select count(*) from db_tab where data->>'$.meta."wintos:inbox"' is null`));
// The PRs tab (1: an Inbox from before the split into PRs and On call).
const PRS_TAB = `data->>'$.meta."wintos:inbox"' in (1, 'prs')`;
if (projects() === 0) {
    await evalIn(await visible(), `window.wintosAction("project")`);
    await until("a project", async () => projects() > 0);
}

// Panes in the Inbox before the run; the run closes every other one at the end.
const inboxPanesAtStart = sql(`select j.value from db_tab t, json_each(t.data->'blockids') j where t.${PRS_TAB}`).split("\n").filter(Boolean);

await scenario("9 · the PRs and the On call tab exist, one of each", async () => {
    const n = (kind) => sql(`select count(*) from db_tab where data->>'$.meta."wintos:inbox"' = '${kind}' or (${kind === "prs" ? "data->>'$.meta.\"wintos:inbox\"' = 1" : "0"})`);
    if (n("prs") !== "1" || n("oncall") !== "1") throw new Error(`PRs tabs ${n("prs")}, On call tabs ${n("oncall")}`);
});

await scenario("1 · ⇧⌘G from a project shows the Inbox with its list focused, and no project renders a PR view", async () => {
    const project = await toProject();
    await press(project, "g", { mods: ["meta", "shift"] });
    const inbox = await until("the Inbox in front", async () => {
        const t = await visible();
        return (await inboxIn(t)) && t;
    });
    await until("the list focused", () => evalIn(inbox, `document.activeElement?.dataset?.wintos === "inbox-list"`));
    // Only the Inbox tabs (PRs, On call) show a list; a project never does.
    for (const t of await renderers()) if (t.id !== inbox.id && (await evalIn(t, `!!document.querySelector("[data-wintos=inbox-list]") && !document.querySelector("[data-wintos=inbox]")`))) throw new Error(`renderer ${t.id.slice(0, 6)} renders a PR list`);
});

let prUrl;
await scenario("2 · a PR opened in the Inbox, and its selected row, are still there after a project and back", async () => {
    const inbox = await visible();
    await evalIn(inbox, `document.querySelector("[data-wintos=inbox-list]").focus()`);
    await press(inbox, "Enter", { code: "Enter", keyCode: 13 });
    prUrl = await until("a PR pane", () => evalIn(inbox, `[...document.querySelectorAll("webview")].map(w => w.getAttribute("src")).find(u => u?.includes("/pull/"))`));
    const row = await evalIn(inbox, `document.querySelector("[data-selected]")?.dataset.pr`);
    await toProject();
    const project = await visible();
    await press(project, "g", { mods: ["meta", "shift"] });
    const back = await until("the Inbox again", async () => ((await inboxIn(await visible())) ? visible() : false));
    const [pane, rowAfter] = await Promise.all([
        evalIn(back, `[...document.querySelectorAll("webview")].some(w => w.getAttribute("src") === ${JSON.stringify(prUrl)})`),
        evalIn(back, `document.querySelector("[data-selected]")?.dataset.pr`),
    ]);
    if (!pane) throw new Error("the PR pane is gone");
    if (rowAfter !== row) throw new Error(`selected row ${rowAfter}, was ${row}`);
});

await scenario("3 · a link leaving GitHub opens a new pane and keeps the PR", async () => {
    const inbox = await visible();
    const pr = `[...document.querySelectorAll("webview")].find(w => w.getAttribute("src") === ${JSON.stringify(prUrl)})`;
    // A real click happens on a loaded page; mid-load the page's address is not GitHub's yet.
    await until("the PR page loaded", () => evalIn(inbox, `(() => { const w = ${pr}; return !!w && w.getURL().includes("github.com") && !w.isLoading(); })()`));
    const before = await evalIn(inbox, `document.querySelectorAll("webview").length`);
    await evalIn(inbox, `[...document.querySelectorAll("webview")].find(w => w.getAttribute("src") === ${JSON.stringify(prUrl)}).executeJavaScript('location.href = "https://example.com/?e2e=${Date.now()}"')`); // unique: an open page is reused, not reopened
    await until("a second pane", async () => (await evalIn(inbox, `document.querySelectorAll("webview").length`)) > before);
    const kept = await evalIn(inbox, `[...document.querySelectorAll("webview")].some(w => w.getURL().includes("github.com"))`);
    if (!kept) throw new Error("the PR page navigated away");
});

await scenario("3b · a new-window link in the Inbox opens a pane you can see", async () => {
    const inbox = await visible();
    const before = await evalIn(inbox, `document.querySelectorAll("webview").length`);
    const url = `https://example.org/?e2e=${Date.now()}`;
    await evalIn(inbox, `[...document.querySelectorAll("webview")].find(w => w.getURL().includes("github.com")).executeJavaScript('window.open(${JSON.stringify(url)}, "_blank")', true)`);
    await until("a new pane", async () => (await evalIn(inbox, `document.querySelectorAll("webview").length`)) > before);
    // Shown, not tiled behind the magnified PR: the strip marks it as the active pane.
    await until("the new pane in front", () => evalIn(inbox, `(() => { const on = document.querySelector("[data-pane][data-on]")?.dataset.pane; return !!on && document.querySelector('[data-blockid="' + on + '"] webview')?.getAttribute("src") === ${JSON.stringify(url)}; })()`));
});

await scenario("4 · ⌘L from the list goes to the page", async () => {
    const inbox = await visible();
    await focusOut(inbox);
    await press(inbox, "l", { mods: ["meta"] });
    await until("the page focused", () => evalIn(inbox, `document.activeElement?.tagName === "WEBVIEW"`));
});

await scenario("8 · ⇧⌘W in the Inbox leaves it open", async () => {
    // Pressed on a project it would close that project: make sure the Inbox is in front first.
    let inbox = await visible();
    if (!(await inboxIn(inbox))) await press(inbox, "g", { mods: ["meta", "shift"] });
    inbox = await until("the Inbox in front", async () => ((await inboxIn(await visible())) ? visible() : false));
    const before = projects();
    await press(inbox, "w", { mods: ["meta", "shift"] });
    await sleep(1500);
    if (!(await inboxIn(await visible()))) throw new Error("the Inbox is no longer in front");
    if (sql(`select count(*) from db_tab where ${PRS_TAB}`) !== "1") throw new Error("the PRs tab is gone");
    // Wave's own ⇧⌘W once shadowed WintOS's and closed a project without asking.
    if (projects() !== before) throw new Error("a project was closed");
});

const inboxId = () => sql(`select oid from db_tab where ${PRS_TAB}`);
const inboxPanes = () => Number(sql(`select json_array_length(data->'blockids') from db_tab where oid = '${inboxId()}'`));
const selectedRow = (t) => evalIn(t, `document.querySelector("[data-selected]")?.dataset.pr`);
const toInbox = async () => {
    const t = await visible();
    if (!(await inboxIn(t))) await press(t, "g", { mods: ["meta", "shift"] });
    const inbox = await until("the Inbox in front", async () => ((await inboxIn(await visible())) ? visible() : false));
    await cdpFocus(inbox, "[data-wintos=inbox-list]");
    return inbox;
};

await scenario("5 · ⌘J from the PR list switches the project and leaves the list cursor where it was", async () => {
    const inbox = await toInbox();
    await press(inbox, "j");
    await until("a row selected", () => selectedRow(inbox));
    const row = await selectedRow(inbox);
    await toProject();
    const after = await selectedRow(inbox);
    if (after !== row) throw new Error(`the list cursor moved from ${row} to ${after}`);
});

await scenario("6 · ⌘W with the list focused closes nothing", async () => {
    const inbox = await toInbox();
    const [panes, before] = [inboxPanes(), projects()];
    await press(inbox, "w", { mods: ["meta"] });
    await sleep(1500);
    if (inboxPanes() !== panes) throw new Error(`${panes - inboxPanes()} pane(s) closed`);
    if (projects() !== before) throw new Error("a project was closed");
});

await scenario("7 · Esc closes the palette and focus goes back to the list; from a page, back to the list", async () => {
    const inbox = await toInbox();
    await press(inbox, "p", { mods: ["meta", "shift"] });
    await until("the palette", () => evalIn(inbox, `!!document.querySelector("[data-wintos=palette]")`));
    // j and z are the list's keys; in the palette's field they are typing.
    const row = await selectedRow(inbox);
    for (const k of ["j", "z"]) {
        const ev = { key: k, code: `Key${k.toUpperCase()}`, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0) };
        await cdp(inbox, "Input.dispatchKeyEvent", { type: "keyDown", text: k, ...ev });
        await cdp(inbox, "Input.dispatchKeyEvent", { type: "keyUp", ...ev });
    }
    const typed = await evalIn(inbox, `document.querySelector("[data-wintos=palette] input")?.value`);
    if (typed !== "jz") throw new Error(`the palette field reads "${typed}", want "jz"`);
    if ((await selectedRow(inbox)) !== row) throw new Error("typing in the palette moved the list");
    // A ⌘ key in the field stays there: no project switches behind the palette.
    await press(inbox, "j", { mods: ["meta"] });
    await sleep(800);
    if (!(await inboxIn(await visible()))) throw new Error("⌘J in the palette switched the project");
    await press(inbox, "Escape", { code: "Escape", keyCode: 27 });
    await until("the palette closed", () => evalIn(inbox, `!document.querySelector("[data-wintos=palette]")`));
    await until("the list focused again", () => evalIn(inbox, `document.activeElement?.dataset?.wintos === "inbox-list"`));
    // A click, as a person would: it gives the guest page real focus.
    const at = await evalIn(inbox, `(() => { const w = [...document.querySelectorAll("webview")].find((w) => w.getURL().includes("github.com") && w.getBoundingClientRect().width > 0); const r = w?.getBoundingClientRect(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    if (!at) throw new Error("no visible page in the Inbox");
    for (const type of ["mousePressed", "mouseReleased"]) await cdp(inbox, "Input.dispatchMouseEvent", { type, ...at, button: "left", clickCount: 1 });
    await until("the page focused", () => evalIn(inbox, `document.activeElement?.tagName === "WEBVIEW"`));
    // CDP's keys never pass Electron's before-input-event, so emain can't forward them: hand the
    // renderer the event emain reinjects for a real Esc in the page.
    await evalIn(inbox, `window.wintosKeyDown({ type: "keydown", key: "Escape", code: "Escape", shift: false, control: false, alt: false, meta: false, cmd: false, option: false, repeat: false, location: 0 })`);
    await until("the list focused from the page", () => evalIn(inbox, `document.activeElement?.dataset?.wintos === "inbox-list"`));
});

await scenario("10 · ⌘D in the Inbox makes no terminal", async () => {
    const inbox = await toInbox();
    const panes = inboxPanes();
    await press(inbox, "d", { mods: ["meta"] });
    await sleep(1500);
    if (inboxPanes() !== panes) throw new Error("a pane was added to the Inbox");
});

await scenario("11 · ⇧⌘Y in a project and in the Inbox shows the Today page, and again goes back", async () => {
    for (const t of [await toProject(), await toInbox()]) {
        await press(t, "y", { mods: ["meta", "shift"] });
        await until("the Today page", () => evalIn(t, `!!document.querySelector("[data-wintos=today]")`));
        if (await evalIn(t, `document.body.innerText.includes("Cannot read properties")`)) throw new Error("the page crashed");
        await press(t, "y", { mods: ["meta", "shift"] });
        await until("the page gone", async () => !(await evalIn(t, `!!document.querySelector("[data-wintos=today]")`)));
    }
});

await scenario("12 · ⌘W on a working session warns first, then shelves it into the notes and the full project view, and ⌥⌘1 resumes it as a new pane", async () => {
    const t = await toProject();
    const tabId = await evalIn(t, "window.wintosTabId()");
    const shelf = async () => (await (await fetch("http://127.0.0.1:7731/state")).json()).shelf?.[tabId] ?? [];
    const panes = () => sql(`select json_array_length(data->'blockids') from db_tab where oid='${tabId}'`);
    // What the hook leaves on a session's pane after its first prompt.
    // A project's shell starts when its terminal first shows: give it a moment to take input.
    await until("a terminal", () => evalIn(t, "!!document.querySelector('.xterm-helper-textarea')"));
    await sleep(2500);
    // A shell still drawing its first prompt drops what was typed, so type again until it lands.
    const resumable = () => sql(`select count(*) from db_block where data->>'$.meta."cmd:initscript"' like '%e2e-shelf%'`) === "1";
    for (let i = 0; i < 4 && !resumable(); i++) {
        await cdpFocus(t, ".xterm-helper-textarea");
        await cdp(t, "Input.insertText", { text: `wsh setmeta -b this "cmd:initscript=cd '/tmp' && claude --resume 'e2e-shelf'"` });
        await press(t, "Enter", { keyCode: 13 });
        await until("the resume command on the pane", resumable, 4000).catch(() => {});
    }
    await until("the resume command on the pane", resumable, 1000);
    // A prompt makes the session working: the first ⌘W only warns, the second closes.
    const blockId = sql(`select oid from db_block where data->>'$.meta."cmd:initscript"' like '%e2e-shelf%'`);
    await fetch("http://127.0.0.1:7731/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tabId, blockId, payload: { session_id: "e2e-shelf", hook_event_name: "UserPromptSubmit", prompt: "e2e shelf" } }) });
    await sleep(1000);
    const before = panes();
    await evalIn(t, `document.querySelector('button[data-key="⌘W"]').click()`);
    await until("the warning", () => evalIn(t, `document.body.innerText.includes("again to stop the working session")`));
    await sleep(500);
    if (panes() !== before) throw new Error("the first ⌘W closed a working session");
    await evalIn(t, `document.querySelector('button[data-key="⌘W"]').click()`);
    await until("the session on the shelf", async () => (await shelf()).some((s) => s.sessionId === "e2e-shelf"));
    await until("the pane closed", () => panes() !== before);
    await until("its row in the notes", () => evalIn(t, `document.querySelector("[data-wintos=shelf-dock]")?.innerText.includes("e2e shelf")`));
    await press(t, "l", { mods: ["meta", "shift"] });
    await until("its row in the full project view", () => evalIn(t, `document.querySelector("[data-wintos=notes-full] [data-wintos=shelf-dock]")?.innerText.includes("e2e shelf")`));
    await press(t, "Escape", { keyCode: 27 });
    await until("the full view closed", async () => !(await evalIn(t, `!!document.querySelector("[data-wintos=notes-full]")`)));
    await press(t, "¡", { code: "Digit1", keyCode: 49, mods: ["alt", "meta"] });
    await until("a new pane resuming it", () => sql(`select count(*) from db_tab t, json_each(t.data->'blockids') j, db_block b where t.oid='${tabId}' and b.oid=j.value and b.data->>'$.meta."cmd:initscript"' like '%e2e-shelf%'`) === "1");
});

await scenario("13 · ⌃⌘H carries the focused pane one place left and it keeps the focus", async () => {
    const t = await toProject();
    const order = () => evalIn(t, `JSON.stringify(window.wintosLayout().getter(window.wintosLayout().leafOrder).map((l) => l.blockid))`);
    const focused = () => evalIn(t, `window.wintosLayout().getter(window.wintosLayout().focusedNode)?.data?.blockId`);
    // An empty project gets its first pane from the first ⌘D, so split until there are two.
    for (let n = JSON.parse(await order()).length; n < 2; n++) {
        await press(t, "d", { mods: ["meta"] });
        await until("a split", async () => JSON.parse(await order()).length === n + 1);
    }
    const split = JSON.parse(await order());
    const mine = await focused();
    if (split.indexOf(mine) < 1) throw new Error(`the new pane is not right of another: ${split}`);
    await press(t, "h", { mods: ["meta", "ctrl"] });
    await until("the pane one place left", async () => JSON.parse(await order()).indexOf(mine) === split.indexOf(mine) - 1);
    if ((await focused()) !== mine) throw new Error("the focus stayed behind");
    await evalIn(t, `window.wintosLayout().closeNode(window.wintosLayout().getNodeByBlockId(${JSON.stringify(mine)}).id)`);
});

await scenario("14 · ⌥⌘P parks the session waiting in a pane just opened", async () => {
    const t = await toProject();
    const tabId = await evalIn(t, "window.wintosTabId()");
    const panes = Number(sql(`select json_array_length(data->'blockids') from db_tab where oid='${tabId}'`));
    await press(t, "d", { mods: ["meta"] });
    await until("a new pane", () => Number(sql(`select json_array_length(data->'blockids') from db_tab where oid='${tabId}'`)) === panes + 1);
    const blockId = await evalIn(t, `window.wintosLayout().getter(window.wintosLayout().focusedNode)?.data?.blockId`);
    const post = (hook_event_name) => fetch("http://127.0.0.1:7731/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tabId, blockId, payload: { session_id: "e2e-park", hook_event_name, prompt: "e2e park" } }) });
    await post("UserPromptSubmit");
    await post("Stop");
    const state = async () => (await (await fetch("http://127.0.0.1:7731/state")).json()).sessions.find((s) => s.id === "e2e-park")?.state;
    await until("the session waiting", async () => (await state()) === "waiting");
    await press(t, "π", { code: "KeyP", keyCode: 80, mods: ["alt", "meta"] }); // what macOS sends for ⌥P
    await until("the session parked", async () => (await state()) === "parked");
    await evalIn(t, `window.wintosLayout().closeNode(window.wintosLayout().getNodeByBlockId(${JSON.stringify(blockId)}).id)`);
});

await scenario("15 · carrying last workday's sub-item into today brings its parent and keeps the nesting", async () => {
    const t = await toProject();
    await press(t, "y", { mods: ["meta", "shift"] });
    await until("the Today page", () => evalIn(t, `!!document.querySelector("[data-wintos=today]")`));
    const carry = (text) => evalIn(t, `(() => { const row = [...document.querySelectorAll("[data-wintos=today] [data-item]")].find((el) => el.textContent.includes(${JSON.stringify(text)}) && el.querySelector("[data-key=c]")); row?.querySelector("[data-key=c]").click(); return !!row; })()`);
    if (!(await carry("measure the threshold"))) throw new Error("no carry button on the sub-item");
    const focus = async () => (await (await fetch("http://127.0.0.1:7731/state")).json()).day.focus;
    await until("the item in today", async () => (await focus()).includes("measure the threshold"));
    if ((await focus()) !== "- [ ] Fallback for low-confidence pages\n  - [ ] measure the threshold") throw new Error(`today is ${JSON.stringify(await focus())}`);
    await press(t, "y", { mods: ["meta", "shift"] });
});

await scenario("16 · a shelved session owning a red PR: the project stays out of Needs you, its Sessions row shows the PR, and ⌥⌘1 resumes it", async () => {
    const t = await toProject();
    const tabId = await evalIn(t, "window.wintosTabId()");
    const st = async () => await (await fetch("http://127.0.0.1:7731/state")).json();
    const gh = (await st()).plugins?.["gh-prs"]?.data;
    const red = gh?.prs.find((p) => p.author === gh.me && p.checks === "FAILURE" && !p.isDraft);
    if (!red) return console.log("      (skipped: none of your PRs has red CI right now)");
    const ev = (hook_event_name, extra = {}) => fetch("http://127.0.0.1:7731/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tabId, blockId: "e2e-gone", payload: { session_id: "e2e-own", hook_event_name, ...extra } }) });
    await ev("UserPromptSubmit", { prompt: "e2e own" });
    await ev("PostToolUse", { prs: [red.url] });
    await fetch(`http://127.0.0.1:7731/projects/${tabId}/shelf`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ script: "cd '/tmp' && claude --resume 'e2e-own'", label: "e2e own" }) });
    await ev("SessionEnd");
    await until("its PR on the shelved row", () => evalIn(t, `[...document.querySelectorAll("[data-wintos=shelf-dock]")].some((e) => e.innerText.includes("#${red.number}"))`));
    const needs = await evalIn(t, `[...document.querySelectorAll("[data-wintos=sidebar-list] [data-tabid='${tabId}']")].some((e) => e.closest("[data-band-group=needs]"))`);
    if (needs) throw new Error("a red PR put the project in Needs you");
    // The resumed Claude has no such session on dev and exits, clearing the pane's resume
    // command (the hook does on exit), so the new pane is counted rather than its command read.
    const panes = () => Number(sql(`select json_array_length(data->'blockids') from db_tab where oid='${tabId}'`));
    const n = await evalIn(t, `[...document.querySelectorAll("[data-wintos=sessions] [data-key^='⌥⌘']")].findIndex((e) => e.closest("[data-wintos=shelf-dock]")?.innerText.includes("#${red.number}")) + 1`);
    const before = panes();
    await press(t, "¡", { code: `Digit${n}`, keyCode: 48 + n, mods: ["alt", "meta"] });
    await until("a pane resuming it", () => panes() === before + 1);
});

await scenario("17 · a click on WintOS itself is mouse mode: no pane frame; a click in the terminal keeps the mode; a shortcut brings the frame back", async () => {
    const t = await toProject();
    const click = async (selector) => {
        const r = await evalIn(t, `(() => { const b = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return b && [b.left + 4, b.top + 4]; })()`);
        if (!r) throw new Error(`nothing to click at ${selector}`);
        for (const type of ["mousePressed", "mouseReleased"]) await cdp(t, "Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1 });
    };
    const mode = () => evalIn(t, "document.documentElement.dataset.wintosInput");
    const frame = () => evalIn(t, `getComputedStyle(document.querySelector(".block.block-focused .block-mask")).borderTopColor`);
    await until("a focused pane", () => evalIn(t, `!!document.querySelector(".block.block-focused .block-mask")`));
    await press(t, "l", { code: "KeyL", keyCode: 76, mods: ["alt", "meta"] });
    await press(t, "l", { code: "KeyL", keyCode: 76, mods: ["alt", "meta"] });
    await until("keyboard mode", async () => (await mode()) === "keyboard");
    await click("[data-band-group] > div");
    await until("mouse mode", async () => (await mode()) === "mouse");
    await until("no pane frame", async () => (await frame()) === "rgba(0, 0, 0, 0)");
    await click(".block.block-focused .block-content");
    await sleep(300);
    if ((await mode()) !== "mouse") throw new Error("a click in the terminal left mouse mode");
    await press(t, "l", { code: "KeyL", keyCode: 76, mods: ["alt", "meta"] });
    await press(t, "l", { code: "KeyL", keyCode: 76, mods: ["alt", "meta"] });
    await until("keyboard mode again", async () => (await mode()) === "keyboard");
});

await scenario("18 · ⇧⌘W shelves the project's sessions, and ⇧⌘P reopens it on the newest", async () => {
    const t = await toProject();
    const tabId = await evalIn(t, "window.wintosTabId()");
    const st = async () => await (await fetch("http://127.0.0.1:7731/state")).json();
    const title = (await st()).projects.find((p) => p.id === tabId)?.title;
    const script = "cd '/tmp' && claude --resume 'e2e-close'";
    for (const hook_event_name of ["UserPromptSubmit", "Stop"])
        await fetch("http://127.0.0.1:7731/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tabId, blockId: "e2e-close-pane", payload: { session_id: "e2e-close", hook_event_name, prompt: "e2e close", resume: script } }) });
    await press(t, "w", { mods: ["meta", "shift"] });
    await until("the close warning", () => evalIn(t, `document.body.innerText.includes("will stop")`));
    await press(t, "w", { mods: ["meta", "shift"] });
    await until("the tab closed", () => sql(`select count(*) from db_tab where oid='${tabId}'`) === "0");
    await until("its session on the shelf", async () => (await st()).shelf?.[tabId]?.[0]?.sessionId === "e2e-close");
    const v = await visible();
    await press(v, "p", { mods: ["meta", "shift"] });
    await until("the palette", () => evalIn(v, `!!document.querySelector("[data-wintos=palette] input")`));
    await cdpFocus(v, "[data-wintos=palette] input");
    await cdp(v, "Input.insertText", { text: title });
    const palette = () => evalIn(v, `document.querySelector("[data-wintos=palette]")?.innerText ?? ""`);
    await until("it listed as shelved", async () => /shelved · \d+ sessions? · ⏎ reopens it on the newest/.test(await palette())).catch(async (e) => { throw new Error(`${e.message} (${title}): ${(await palette()).replace(/\n/g, " | ").slice(0, 300)}`); });
    await press(v, "Enter", { keyCode: 13 });
    await until("a new tab resuming it", async () => {
        const id = (await st()).projects.find((p) => p.title === title)?.id;
        return id && id !== tabId && sql(`select count(*) from db_tab t, json_each(t.data->'blockids') j, db_block b where t.oid='${id}' and b.oid=j.value and b.data->>'$.meta."cmd:initscript"' like '%e2e-close%'`) === "1";
    }, 20000);
});

await scenario("19 · an empty project closes when you leave it (⇧⌘G here), and keeps its folder", async () => {
    const t = await toProject();
    const tabId = await evalIn(t, "window.wintosTabId()");
    await evalIn(t, `(async () => { const lm = window.wintosLayout(); for (const el of document.querySelectorAll("[data-blockid]")) { const n = lm.getNodeByBlockId(el.dataset.blockid); if (n) await lm.closeNode(n.id); } })()`);
    await until("the project empty", () => evalIn(t, `document.body.innerText.includes("Nothing open in this project")`));
    await sleep(500);
    if (sql(`select count(*) from db_tab where oid='${tabId}'`) !== "1") throw new Error("the empty project closed before you left it");
    await press(t, "g", { mods: ["meta", "shift"] });
    await until(`its tab closed (active: ${sql(`select data->>'activetabid' from db_workspace limit 1`).slice(0, 8)}, it: ${tabId.slice(0, 8)})`, () => sql(`select count(*) from db_tab where oid='${tabId}'`) === "0");
    if (!(await (await fetch("http://127.0.0.1:7731/state")).json()).projects.some((p) => p.id === tabId)) throw new Error("its project is gone");
});

// The run leaves the Inbox as it found it: the pages it opened close again. A failed clean-up
// must not cost the run its results.
await scenario("clean-up · the panes this run opened are closed", async () => {
    const inbox = await toInbox();
    await evalIn(inbox, `(async () => {
        const keep = new Set(${JSON.stringify(inboxPanesAtStart)});
        const lm = window.wintosLayout();
        for (const el of document.querySelectorAll("[data-blockid]")) {
            const node = !keep.has(el.dataset.blockid) && lm.getNodeByBlockId(el.dataset.blockid);
            if (node) await lm.closeNode(node.id);
        }
    })()`);
});

clearInterval(heldTimer);
for (const r of results) console.log(r.join("  "));
process.exit(results.some((r) => r[0] === "FAIL") ? 1 : 0);
