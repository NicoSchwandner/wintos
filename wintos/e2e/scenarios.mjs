// Interaction checks against the running WintOS dev instance (wintos/dev-instance.sh, debug port
// 9224): real key events over CDP, assertions on the DOM of each renderer. Never point this at the
// everyday instance; its keystrokes would land in the developer's window.
// usage: node wintos/e2e/scenarios.mjs
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
// Layout leaves whose block is gone: the empty half a racing close leaves behind.
const ghostLeaves = (tabId) => Number(sql(`select count(*) from db_tab t, db_layout l, json_each(l.data->'leaforder') j where t.oid='${tabId}' and l.oid=t.data->>'layoutstate' and j.value->>'blockid' not in (select b.value from json_each(t.data->'blockids') b)`));
const results = [];
// ONLY=<regex> runs the matching scenarios, e.g. ONLY="^2[01] " to iterate on two of them.
const only = process.env.ONLY && new RegExp(process.env.ONLY);
async function scenario(name, fn) {
    if (only && !only.test(name)) return;
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

// The scenarios read the notes and the quiet projects, which are folded by default: open both.
for (const r of await renderers()) await evalIn(r, `localStorage.setItem("wintos:notes-folded", "0"); localStorage.setItem("wintos:quiet-unfolded", "1"); window.dispatchEvent(new StorageEvent("storage"))`);

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
    // Right after a reset GitHub is still loading: Enter on an empty list opens nothing.
    await until("the PR list loaded", () => evalIn(inbox, `!!document.querySelector("[data-selected]")`), 90_000);
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
    const at = await evalIn(inbox, `(() => { const area = (w) => { const r = w.getBoundingClientRect(); return r.y >= 0 && r.width > 100 && r.height > 100 ? r.width * r.height : 0; }; const w = [...document.querySelectorAll("webview")].filter((w) => w.getURL().includes("github.com") && area(w)).sort((a, b) => area(b) - area(a))[0]; const r = w?.getBoundingClientRect(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
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

await scenario("12 · ⌘W on a working session warns first, then shelves it into the notes, and its row in the notes resumes it as a new pane", async () => {
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
    await until("the warning", () => evalIn(t, `document.body.innerText.includes("to stop the working session")`));
    await sleep(500);
    if (panes() !== before) throw new Error("the first ⌘W closed a working session");
    await evalIn(t, `document.querySelector('button[data-key="⌘W"]').click()`);
    await until("the session on the shelf", async () => (await shelf()).some((s) => s.sessionId === "e2e-shelf"));
    await until("the pane closed", () => panes() !== before);
    await until("its row in the notes", () => evalIn(t, `document.querySelector("[data-wintos=shelf-dock]")?.innerText.includes("e2e shelf")`));
    await evalIn(t, `document.querySelector("[data-wintos=shelf-dock] button[data-act]").click()`);
    await until("a new pane resuming it", () => sql(`select count(*) from db_tab t, json_each(t.data->'blockids') j, db_block b where t.oid='${tabId}' and b.oid=j.value and b.data->>'$.meta."cmd:initscript"' like '%e2e-shelf%'`) === "1");
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
    // ⌥⌘P parks what the window knows is waiting, which can trail the daemon by a broadcast.
    await until("the window seeing it waiting", () => evalIn(t, `window.wintosState()?.sessions.some((s) => s.id === "e2e-park" && s.state === "waiting")`));
    await press(t, "π", { code: "KeyP", keyCode: 80, mods: ["alt", "meta"] }); // what macOS sends for ⌥P
    await until("the session parked", async () => (await state()) === "parked");
    await evalIn(t, `window.wintosLayout().closeNode(window.wintosLayout().getNodeByBlockId(${JSON.stringify(blockId)}).id)`);
});

await scenario("14b · a session that parks itself goes quiet at once, saying what it waits on: nothing to read yet", async () => {
    const t = await toProject();
    const tabId = await evalIn(t, "window.wintosTabId()");
    const first = await evalIn(t, `window.wintosLayout().getter(window.wintosLayout().focusedNode)?.data?.blockId`);
    await press(t, "d", { mods: ["meta"] });
    const blockId = await until("a new pane focused", async () => { const b = await evalIn(t, `window.wintosLayout().getter(window.wintosLayout().focusedNode)?.data?.blockId`); return b !== first && b; });
    const focus = (b) => evalIn(t, `window.wintosLayout().focusNode(window.wintosLayout().getNodeByBlockId(${JSON.stringify(b)}).id)`);
    await focus(first);
    const post = (hook_event_name, extra = {}) => fetch("http://127.0.0.1:7731/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tabId, blockId, payload: { session_id: "e2e-ack", hook_event_name, prompt: "e2e ack", ...extra } }) });
    await post("UserPromptSubmit");
    await fetch(`http://127.0.0.1:7731/blocks/${blockId}/wait?session=e2e-ack`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "CI on #1" }) });
    await post("Stop", { last_assistant_message: "## Done\n\nPushed the **fix**; CI is running." });
    const row = (band) => `[...document.querySelectorAll("[data-wintos=sidebar-list] [data-band-group=${band}] [data-tabid='${tabId}']")].map((e) => e.innerText).join(" ")`;
    // The active row shows the walk keys instead of its line, so read it in another tab's sidebar.
    const others = [];
    for (const r of await renderers()) if ((await evalIn(r, "window.wintosTabId?.()")) !== tabId) others.push(r);
    const elsewhere = (band, line) => until(`"${line}" in ${band} in another sidebar`, async () => { for (const r of others) if ((await evalIn(r, row(band))).includes(line)) return true; return false; });
    await elsewhere("quiet", "paused on CI on #1");
    if (await evalIn(t, row("read"))) throw new Error("a parked turn in To read");
    await evalIn(t, `window.wintosLayout().closeNode(window.wintosLayout().getNodeByBlockId(${JSON.stringify(blockId)}).id)`);
});

await scenario("16 · a shelved session owning a red PR: the project stays out of Needs you, its Sessions row shows the PR, and that row resumes it", async () => {
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
    const before = panes();
    await evalIn(t, `[...document.querySelectorAll("[data-wintos=shelf-dock]")].find((e) => e.innerText.includes("#${red.number}"))?.querySelector("button[data-act]").click()`);
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
    await until("when each was last touched", () => evalIn(v, `[...document.querySelectorAll("[data-wintos=palette-touched]")].some((e) => /ago$/.test(e.innerText))`));
    await press(v, "Enter", { keyCode: 13 });
    await until("a new tab resuming it", async () => {
        const id = (await st()).projects.find((p) => p.title === title)?.id;
        return id && id !== tabId && sql(`select count(*) from db_tab t, json_each(t.data->'blockids') j, db_block b where t.oid='${id}' and b.oid=j.value and b.data->>'$.meta."cmd:initscript"' like '%e2e-close%'`) === "1";
    }, 20000);
    const back = (await st()).projects.find((p) => p.title === title).id;
    await sleep(1000);
    const panes = (id) => Number(sql(`select coalesce(json_array_length(data->'blockids'), 0) from db_tab where oid='${id}'`));
    if (panes(back) !== 1 || ghostLeaves(back)) throw new Error(`the reopened project has ${panes(back)} panes and ${ghostLeaves(back)} empty leaves, want 1 and 0`);
});

// The app menu's Undo item hands ⌘Z to the window; CDP keys skip the menu, so the action is run.
await scenario("20 · ⌘Z brings back the pane ⌘W closed, and the project ⇧⌘W closed with its panes; a toast says so", async () => {
    let t = await toProject();
    const tabId = await evalIn(t, "window.wintosTabId()");
    const st = async () => await (await fetch("http://127.0.0.1:7731/state")).json();
    const title = (await st()).projects.find((p) => p.id === tabId)?.title;
    const panes = (id) => Number(sql(`select coalesce(json_array_length(data->'blockids'), 0) from db_tab where oid='${id}'`));
    for (let n = panes(tabId); n < 2; n++) {
        await press(t, "d", { mods: ["meta"] });
        await until("a split", () => panes(tabId) === n + 1);
    }
    const before = panes(tabId);
    await until("a focused pane", () => evalIn(t, `!!document.querySelector('button[data-key="⌘W"]')`));
    await evalIn(t, `document.querySelector('button[data-key="⌘W"]').click()`);
    await until("the pane closed", () => panes(tabId) === before - 1);
    await until("the toast", () => evalIn(t, `document.querySelector("[data-wintos=undo-toast]")?.innerText.includes("Closed")`));
    await evalIn(t, `window.wintosAction("undo")`);
    await until("the pane back", () => panes(tabId) === before);
    await sleep(500);
    await press(t, "w", { mods: ["meta", "shift"] });
    if (await evalIn(t, `!!document.querySelector("[data-wintos=confirm-close]")`)) await press(t, "w", { mods: ["meta", "shift"] });
    await until("the tab closed", () => sql(`select count(*) from db_tab where oid='${tabId}'`) === "0");
    const v = await visible();
    await until("the toast in the tab you land in", () => evalIn(v, `document.querySelector("[data-wintos=undo-toast]")?.innerText.includes(${JSON.stringify(`Closed ${title}`)})`));
    await evalIn(v, `window.wintosAction("undo")`);
    let seen = "";
    await until("the project back with its panes", async () => {
        const id = (await st()).projects.find((p) => p.title === title)?.id;
        seen = `${id?.slice(0, 8)} with ${id ? panes(id) : "-"} panes, want ${before}`;
        return id && id !== tabId && panes(id) === before;
    }, 20000).catch((e) => { throw new Error(`${e.message}: ${seen}`); });
    const back = (await st()).projects.find((p) => p.title === title).id;
    await sleep(1000);
    if (ghostLeaves(back)) throw new Error(`the reopened project has ${ghostLeaves(back)} empty leaves`);
});

await scenario("21 · ⌘W in a project with no pane left closes the project", async () => {
    const t = await toProject();
    const tabId = await evalIn(t, "window.wintosTabId()");
    await evalIn(t, `(async () => { const lm = window.wintosLayout(); for (const el of document.querySelectorAll("[data-blockid]")) { const n = lm.getNodeByBlockId(el.dataset.blockid); if (n) await lm.closeNode(n.id); } })()`);
    await until("the project empty", () => evalIn(t, `document.body.innerText.includes("Nothing open in this project")`));
    await press(t, "w", { mods: ["meta"] });
    await until("its tab closed", () => sql(`select count(*) from db_tab where oid='${tabId}'`) === "0");
});

// The dev instance's fixer runs e2e/fake-claude.sh: it sees your real PRs and must leave them alone.
await scenario("22 · a in the PRs tab turns the conflicts fixer off and on; a conflicted PR of yours gets a run, on its row", async () => {
    // The Inbox can be On call (closing a project lands there); a is a PRs tab key.
    let inbox = await toInbox();
    const onPrs = (t) => evalIn(t, `!!document.querySelector("[data-wintos=inbox-list]")?.innerText.startsWith("PRs need attention")`);
    if (!(await onPrs(inbox))) {
        await press(inbox, "g", { mods: ["meta", "shift"] });
        inbox = await until("the PRs tab", async () => { const t = await visible(); return (await onPrs(t)) && t; });
        await cdpFocus(inbox, "[data-wintos=inbox-list]");
    }
    const fixer = async () => (await (await fetch("http://127.0.0.1:7731/state")).json()).fixer;
    const before = (await fixer()).conflicts;
    // Right after a tab switch the list may not have its keys yet: press until it answers.
    const toggleTo = async (want) => {
        for (let i = 0; i < 4 && (await fixer()).conflicts !== want; i++) {
            await cdpFocus(inbox, "[data-wintos=inbox-list]");
            await press(inbox, "a", { keyCode: 65 });
            await until(`the fixer ${want ? "on" : "off"}`, async () => (await fixer()).conflicts === want, 2000).catch(() => {});
        }
        if ((await fixer()).conflicts !== want) throw new Error(`a left the fixer ${want ? "off" : "on"}`);
    };
    await toggleTo(!before);
    await toggleTo(before);
    const gh = (await (await fetch("http://127.0.0.1:7731/state")).json()).plugins?.["gh-prs"]?.data;
    const conflicted = gh?.prs.find((p) => p.author === gh.me && p.conflict && !p.mergedAt && p.head);
    if (!before || !conflicted) return console.log("      (run check skipped: the fixer is off or none of your PRs is in conflict)");
    await until("its run ended", async () => (await fixer()).runs.some((r) => r.url === conflicted.url && r.result === "dev instance: nothing done"), 30000);
    await until("its row says so", () => evalIn(inbox, `[...document.querySelectorAll("[data-pr='${conflicted.repo}#${conflicted.number}'] [data-wintos=pr-fix]")].some((e) => e.innerText.includes("conflict"))`));
});

await scenario("23 · a page that closes itself (a sign-in popup) closes its pane, and the window keeps working", async () => {
    const t = await toProject();
    const tabId = await evalIn(t, "window.wintosTabId()");
    const panes = () => Number(sql(`select coalesce(json_array_length(data->'blockids'), 0) from db_tab where oid='${tabId}'`));
    const before = panes();
    // A data: URL is taken for a search, so the page is served for real.
    const server = createServer((_q, res) => res.end("<p>signing in</p><script>setTimeout(() => window.close(), 800)</script>"));
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    try {
        await evalIn(t, `window.wintosAction("open-url:http://127.0.0.1:${server.address().port}/")`);
        await until("the page's pane", () => panes() === before + 1);
        await until("its pane closed", () => panes() === before);
    } finally {
        server.close();
    }
    await sleep(500);
    if (!(await evalIn(t, `!!document.querySelector("[data-wintos=sidebar-list]")`))) throw new Error("the window stopped rendering after the page closed itself");
});

await scenario("24 · a session proposes its name, ⌘R renames it for good, and its next name waits as a suggestion", async () => {
    const t = await toProject();
    const tabId = await evalIn(t, "window.wintosTabId()");
    const blockId = await until("a focused pane", () => evalIn(t, `window.wintosLayout().getter(window.wintosLayout().focusedNode)?.data?.blockId`));
    const post = (path, body) => fetch(`http://127.0.0.1:7731${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const named = async () => (await (await fetch("http://127.0.0.1:7731/state")).json()).sessions.find((x) => x.id === "e2e-name")?.name;
    await post("/events", { tabId, blockId, payload: { session_id: "e2e-name", hook_event_name: "UserPromptSubmit", prompt: "e2e name" } });
    await post(`/blocks/${blockId}/name?session=e2e-name`, { text: "Retention backfill review" });
    await until("the proposed name in its header, with its minute", () => evalIn(t, `[...document.querySelectorAll("[data-wintos=session-header]")].some((h) => h.innerText.includes("Retention backfill review") && h.innerText.includes("change the name"))`));
    await press(t, "r", { code: "KeyR", keyCode: 82, mods: ["meta"] });
    await until("the name field", () => evalIn(t, `!!document.querySelector("[data-wintos=name-session] input")`));
    await cdpFocus(t, "[data-wintos=name-session] input");
    await evalIn(t, `document.querySelector("[data-wintos=name-session] input").select()`);
    await cdp(t, "Input.insertText", { text: "My name for it" });
    await press(t, "Enter", { keyCode: 13 });
    await until("your name, kept", async () => (await named())?.by === "you" && (await named())?.text === "My name for it");
    await post(`/blocks/${blockId}/name?session=e2e-name`, { text: "Its next name" });
    await until("its suggestion, beside your name", () => evalIn(t, `[...document.querySelectorAll("[data-wintos=session-header]")].some((h) => h.innerText.includes("My name for it") && h.innerText.includes("Its next name"))`));
    await post("/events", { tabId, blockId, payload: { session_id: "e2e-name", hook_event_name: "SessionEnd", reason: "prompt_input_exit" } });
});

// The run leaves the Inbox as it found it: the pages it opened close again. A failed clean-up
// must not cost the run its results.
await scenario("25 · a turn that asks you to decide sits in Your move saying so, and leaves it once you answer", async () => {
    const t = await toProject();
    const tabId = await evalIn(t, "window.wintosTabId()");
    const first = await evalIn(t, `window.wintosLayout().getter(window.wintosLayout().focusedNode)?.data?.blockId`);
    await press(t, "d", { mods: ["meta"] });
    const blockId = await until("a new pane focused", async () => { const b = await evalIn(t, `window.wintosLayout().getter(window.wintosLayout().focusedNode)?.data?.blockId`); return b !== first && b; });
    const post = (hook_event_name, extra = {}) => fetch("http://127.0.0.1:7731/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tabId, blockId, payload: { session_id: "e2e-ask", hook_event_name, prompt: "e2e ask", ...extra } }) });
    await post("UserPromptSubmit");
    await fetch(`http://127.0.0.1:7731/blocks/${blockId}/ask?session=e2e-ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "decide", text: "two bands or one" }) });
    await post("Stop", { last_assistant_message: "Two ways to show it. Which one?" });
    const row = (band) => `[...document.querySelectorAll("[data-wintos=sidebar-list] [data-band-group=${band}] [data-tabid='${tabId}']")].map((e) => e.innerText).join(" ")`;
    const others = [];
    for (const r of await renderers()) if ((await evalIn(r, "window.wintosTabId?.()")) !== tabId) others.push(r);
    await until("Decide in Your move in another sidebar", async () => { for (const r of others) { const text = await evalIn(r, row("needs")); if (/Decide\s+two bands or one/.test(text)) return true; } return false; });
    await post("UserPromptSubmit");
    await until("out of Your move", async () => !(await evalIn(t, row("needs"))), 8000);
    await evalIn(t, `window.wintosLayout().closeNode(window.wintosLayout().getNodeByBlockId(${JSON.stringify(blockId)}).id)`);
});

await scenario("26 · a heads-up from the plugin shows in its project's notes, stays once the plugin clears it, and x closes it", async () => {
    const t = await toProject();
    const tabId = await evalIn(t, "window.wintosTabId()");
    const blockId = await evalIn(t, `window.wintosLayout().getter(window.wintosLayout().focusedNode)?.data?.blockId`);
    await fetch("http://127.0.0.1:7731/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tabId, blockId, payload: { session_id: "e2e-headsup", hook_event_name: "UserPromptSubmit", prompt: "e2e heads-up" } }) });
    const store = `${homedir()}/.local/share/wintos-dev/claude/plugins/store/cc-plugin-you-should-know_builtin-e2e.json`;
    const line = "Merging this won't deploy it: the API needs its own release.";
    const write = (sessions, seen) => writeFileSync(store, JSON.stringify({ known: [], seen, sessions }));
    write([{ id: "e2e-headsup", view: { kind: "offer", line, explanation: "e2e why", shownAt: Date.now() } }], [line]);
    const shown = () => evalIn(t, `document.querySelector("[data-wintos=headsups]")?.innerText ?? ""`);
    await until("the heads-up in the notes", async () => (await shown()).includes("won't deploy it"));
    write([{ id: "e2e-headsup" }], [line]);
    await sleep(500);
    if (!(await shown()).includes("won't deploy it")) throw new Error("the heads-up went when the plugin cleared it");
    await evalIn(t, `document.querySelector("[data-wintos=notes-rail]").focus()`);
    await press(t, "j");
    await press(t, "x");
    await until("the heads-up closed", async () => !(await shown()));
});

await scenario("27 · an unwritten reflection nudges on the Today card; ⌥⌘Y opens it beside its week, and writing it ends the nudge", async () => {
    const t = await toProject();
    const d = new Date(Date.now() - 2 * 86_400_000);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const dir = `${homedir()}/.local/share/wintos-dev/journal/days/${iso.slice(0, 4)}/${iso.slice(5, 7)}`;
    mkdirSync(dir, { recursive: true });
    const file = `${dir}/${iso}.md`;
    const before = existsSync(file) ? readFileSync(file, "utf8") : `# ${iso}\n\n## Today's focus (1-3 items)\n\n- [x] Ship the e2e export\n\n`;
    const tpl = readFileSync(new URL("./fixtures/weekly_template.md", import.meta.url), "utf8");
    writeFileSync(file, `${before.trimEnd()}\n\n${tpl.slice(tpl.indexOf("## Weekly"))}`);
    const nudge = () => evalIn(t, `!!document.querySelector("[data-wintos=reflect-nudge]")`);
    await until("the nudge on the Today card", nudge);
    await press(t, "y", { code: "KeyY", mods: ["alt", "meta"] });
    await until("the reflection page", () => evalIn(t, `!!document.querySelector("[data-wintos=reflect]")`));
    await until("its week", async () => (await evalIn(t, `document.querySelector("[data-wintos=reflect-lookback]")?.innerText ?? ""`)).toLowerCase().includes("your week"));
    await press(t, "e", { mods: ["meta"] });
    await until("the editor, focused", () => evalIn(t, `document.activeElement?.dataset?.wintos === "mine-editor"`));
    await evalIn(t, `(() => { const e = document.querySelector("[data-wintos=mine-editor]"); e.setSelectionRange(e.value.indexOf("forward?") + 8, e.value.indexOf("forward?") + 8); })()`);
    await cdp(t, "Input.insertText", { text: "\n    - The e2e week went well" });
    await press(t, "Enter", { keyCode: 13, mods: ["meta"] });
    await until("the answer in the file", () => readFileSync(file, "utf8").includes("    - The e2e week went well"));
    await until("the nudge gone", async () => !(await nudge()));
    await cdpFocus(t, "[data-wintos=reflect]");
    await press(t, "Escape", { keyCode: 27 });
    await until("the page gone", async () => !(await evalIn(t, `!!document.querySelector("[data-wintos=reflect]")`)));
});

await scenario("28 · ⌃⇥ held walks to the first session that needs you, past quiet ones, and only the ⌃ release switches", async () => {
    const active = () => sql(`select data->>'activetabid' from db_workspace limit 1`);
    let t = await toProject();
    const from = active();
    await press(t, "n", { mods: ["meta"] });
    await until("the new-step sheet", () => evalIn(t, `!!document.querySelector("[data-wintos=new-step]")`));
    await press(t, "Enter", { code: "Enter", keyCode: 13 });
    await until("a new project in front", () => active() !== from);
    t = await visible();
    const here = active();
    // A session in another view asks you something, so Your move has a row outside this view.
    const api = (path, body) => fetch(`http://127.0.0.1:7731${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const other = sql(`select oid from db_tab where oid != '${here}' and json_array_length(data->'blockids') > 0 limit 1`);
    const pane = sql(`select json_extract(data, '$.blockids[0]') from db_tab where oid='${other}'`);
    await api("/events", { tabId: other, blockId: pane, payload: { session_id: "e2e-ct", hook_event_name: "UserPromptSubmit", prompt: "e2e" } });
    await api(`/blocks/${pane}/ask`, { kind: "decide", text: "e2e: which one?" });
    await api("/events", { tabId: other, blockId: pane, payload: { session_id: "e2e-ct", hook_event_name: "Stop" } });
    // Read from a view that has a size: one opened during the run may not draw while the window is covered.
    const top = await until("the first row in Your move outside this view", async () => {
        for (const r of await renderers()) {
            if (!(await evalIn(r, "innerWidth > 0"))) continue;
            const first = await evalIn(r, `[...document.querySelectorAll("[data-wintos=sidebar-list] [data-band-group=needs] [data-tabid]")].map((e) => e.dataset.tabid).filter((id) => !id.includes(":") && id !== "${here}")[0] ?? false`);
            if (first) return first;
        }
        return false;
    });
    await focusOut(t);
    const tab = { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: MODS.ctrl };
    await cdp(t, "Input.dispatchKeyEvent", { type: "rawKeyDown", ...tab });
    await cdp(t, "Input.dispatchKeyEvent", { type: "keyUp", ...tab });
    await sleep(800);
    if (active() !== here) throw new Error("⌃⇥ switched before ⌃ was released");
    await cdp(t, "Input.dispatchKeyEvent", { type: "keyUp", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17 });
    await until("on the first session that needs you", () => active() === top);
});

await scenario("29 · the open project's title heads its session strip", async () => {
    const t = await toProject();
    const tabId = sql(`select data->>'activetabid' from db_workspace limit 1`);
    const title = (await (await fetch("http://127.0.0.1:7731/state")).json()).projects.find((p) => p.id === tabId)?.title;
    if (!title) throw new Error("the open project has no title");
    await until("the title above the panes", async () => (await evalIn(t, `document.querySelector("[data-wintos=project-title]")?.textContent ?? ""`)) === title);
});

await scenario("30 · in the PRs tab, f names each row's next step: a review row's (yours or the team's) is a review", async () => {
    let inbox = await toInbox();
    const onPrs = (t) => evalIn(t, `!!document.querySelector("[data-wintos=inbox-list]")?.innerText.startsWith("PRs need attention")`);
    if (!(await onPrs(inbox))) {
        await press(inbox, "g", { mods: ["meta", "shift"] });
        inbox = await until("the PRs tab", async () => { const t = await visible(); return (await onPrs(t)) && t; });
    }
    await cdpFocus(inbox, "[data-wintos=inbox-list]");
    const groupOfCursor = () => evalIn(inbox, `document.querySelector("[data-wintos=inbox-list] [data-selected]")?.closest("[data-group]")?.dataset.group ?? ""`);
    const reviewRow = async () => ["review", "team"].includes(await groupOfCursor());
    await until("the PR rows", () => evalIn(inbox, `!!document.querySelector("[data-wintos=inbox-list] [data-pr]")`), 20000);
    if (!(await evalIn(inbox, `!!document.querySelector("[data-group=review] [data-pr], [data-group=team] [data-pr]")`))) return console.log("      (skipped: no review is asked of you or your team right now)");
    for (let i = 0; i < 80 && !(await reviewRow()); i++) await press(inbox, "j", { keyCode: 74 });
    if (!(await reviewRow())) throw new Error("j never reached a review row");
    await until("f offers the review", async () => /\bf\s*(re-)?review\b/.test(await evalIn(inbox, `document.querySelector("[data-wintos=pr-next]")?.innerText ?? ""`)));
});

await scenario("32 · a turn that ends with its subagent still running sits in Running, saying it comes back by itself; its stop makes it your move", async () => {
    const t = await toProject();
    const tabId = await evalIn(t, "window.wintosTabId()");
    const first = await evalIn(t, `window.wintosLayout().getter(window.wintosLayout().focusedNode)?.data?.blockId`);
    await press(t, "d", { mods: ["meta"] });
    const blockId = await until("a new pane focused", async () => { const b = await evalIn(t, `window.wintosLayout().getter(window.wintosLayout().focusedNode)?.data?.blockId`); return b !== first && b; });
    await evalIn(t, `window.wintosLayout().focusNode(window.wintosLayout().getNodeByBlockId(${JSON.stringify(first)}).id)`);
    const post = (hook_event_name, extra = {}) => fetch("http://127.0.0.1:7731/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tabId, blockId, payload: { session_id: "e2e-agent", hook_event_name, prompt: "e2e agent", ...extra } }) });
    await post("UserPromptSubmit");
    await post("SubagentStart", { agent_id: "e2e-a1" });
    await post("Stop", { last_assistant_message: "Waiting for the review agent." });
    const row = (band) => `[...document.querySelectorAll("[data-wintos=sidebar-list] [data-band-group=${band}] [data-tabid='${tabId}']")].map((e) => e.innerText).join(" ")`;
    const others = [];
    for (const r of await renderers()) if ((await evalIn(r, "window.wintosTabId?.()")) !== tabId) others.push(r);
    const elsewhere = (band, line) => until(`"${line}" in ${band} in another sidebar`, async () => { for (const r of others) if ((await evalIn(r, row(band))).includes(line)) return true; return false; });
    await elsewhere("running", "comes back by itself");
    await post("SubagentStop", { agent_id: "e2e-a1" });
    try {
        await until("the project in Your move", async () => { for (const r of others) if (await evalIn(r, row("needs"))) return true; return false; });
    } catch (e) {
        const st = (await (await fetch("http://127.0.0.1:7731/state")).json()).sessions.find((x) => x.id === "e2e-agent");
        const bands = await Promise.all(others.map((r) => evalIn(r, `[...document.querySelectorAll("[data-band-group]")].map((g) => g.dataset.bandGroup + ":" + g.querySelectorAll("[data-tabid='${tabId}']").length).join(" ")`)));
        throw new Error(`${e.message}; session ${JSON.stringify(st && { state: st.state, subagents: st.subagents, turnEndedAt: st.turnEndedAt })}; sidebars ${JSON.stringify(bands)}`);
    }
    await evalIn(t, `window.wintosLayout().closeNode(window.wintosLayout().getNodeByBlockId(${JSON.stringify(blockId)}).id)`);
});

await scenario("33 · ⌥⌘B starts a break: the status bar counts it, the sidebar's meter says so, and the menu key path reaches the daemon", async () => {
    const t = await toProject();
    await press(t, "∫", { code: "KeyB", keyCode: 66, mods: ["alt", "meta"] }); // what macOS sends for ⌥B
    await until("the break in the daemon", async () => !!(await (await fetch("http://127.0.0.1:7731/state")).json()).rhythm?.onBreak);
    await until("the status bar counting it", () => evalIn(t, `document.querySelector("[data-wintos=on-break]")?.innerText?.startsWith("on a break")`));
    await until("the sidebar's meter saying it", () => evalIn(t, `document.querySelector("[data-wintos=rhythm-meter]")?.innerText.includes("on a break")`));
});

await scenario("37 · wintos unit: the project's steps in the side column, the current one holding the lane; step i/n in the header", async () => {
    const t = await toProject();
    const tabId = await evalIn(t, "window.wintosTabId()");
    const api = (path, body) => fetch(`http://127.0.0.1:7731${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const pane = await evalIn(t, `document.querySelector("[data-blockid]")?.dataset.blockid`);
    await api("/events", { tabId, blockId: pane, payload: { session_id: "e2e-units", hook_event_name: "UserPromptSubmit", prompt: "e2e units" } });
    const q = "?session=e2e-units";
    await api(`/blocks/${pane}/units${q}`, { items: ["ABC-41 fields check", "ABC-42 phase 1", "ABC-43 match log"] });
    await api(`/blocks/${pane}/units${q}`, { done: "ABC-41" });
    await api(`/blocks/${pane}/units${q}`, { start: "ABC-42" });
    await api(`/blocks/${pane}/lane${q}`, { name: "fast", steps: ["Failing test", "Fix"] });
    await until("the units in the side column", async () => (await evalIn(t, `[...document.querySelectorAll("[data-wintos=project-units] [data-unit]")].map((e) => e.dataset.unit).join(",")`)) === "done,current,todo");
    if (!(await evalIn(t, `document.querySelector("[data-unit=current]")?.innerText.includes("Failing test")`))) throw new Error("the current unit does not hold the lane");
    if (!(await evalIn(t, `document.querySelector("[data-wintos=unit-of]")?.innerText === "step 2/3"`))) throw new Error("no step 2/3 in the header");
});

await scenario("38 · epics: a session's epic heads its pane and marks its row; ⌥⌘E picks another by its digit", async () => {
    const t = await toProject();
    const tabId = await evalIn(t, "window.wintosTabId()");
    const api = (path, body) => fetch(`http://127.0.0.1:7731${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    // A pane of its own: an earlier scenario's session may still sit in the first one.
    const first = await evalIn(t, `window.wintosLayout().getter(window.wintosLayout().focusedNode)?.data?.blockId`);
    await press(t, "d", { mods: ["meta"] });
    const pane = await until("a new pane focused", async () => { const b = await evalIn(t, `window.wintosLayout().getter(window.wintosLayout().focusedNode)?.data?.blockId`); return b !== first && b; });
    const a = await (await api("/epics", { title: "E2E archive", short: "Archive" })).text();
    const b = await (await api("/epics", { title: "E2E release" })).text();
    await api("/events", { tabId, blockId: pane, payload: { session_id: "e2e-epic", hook_event_name: "UserPromptSubmit", prompt: "e2e epic" } });
    await api("/sessions/e2e-epic/epic", { epic: a });
    // One header names the epic: the strip over the view, as a session of it (its own pane header
    // repeats it only in a view mixing epics).
    await until("the epic over the pane, as a session of it", () => evalIn(t, `(() => { const st = document.querySelector("[data-wintos=epic-strip][data-epic='${a}']"); return !!st && st.dataset.role === "session" && st.innerText.toUpperCase().includes("E2E ARCHIVE · SESSION"); })()`));
    const mixed = await evalIn(t, `new Set([...document.querySelectorAll("[data-wintos=session-header]")].map((h) => h.dataset.epic)).size > 1`);
    if (!mixed && (await evalIn(t, `!!document.querySelector("[data-wintos=session-header][data-epic='${a}'] [data-wintos=session-epic]")`))) throw new Error("a second epic header in a view of one epic");
    await until("the avatar on its row", () => evalIn(t, `!!document.querySelector("[data-tabid='${tabId}'] [data-wintos=epic-avatar]")`));
    await press(t, "e", { code: "KeyE", mods: ["meta", "alt"] });
    await until("the epic picker", () => evalIn(t, `!!document.querySelector("[data-wintos=epic-picker]")`));
    const digit = (await evalIn(t, `document.querySelector("[data-wintos=epic-picker] [data-epic='${b}']")?.dataset.key`)).replace("⌘", "");
    // Straight to the picker's field: press() with a modifier first moves focus to the body.
    for (const type of ["rawKeyDown", "keyUp"]) await cdp(t, "Input.dispatchKeyEvent", { type, key: digit, code: `Digit${digit}`, windowsVirtualKeyCode: 48 + Number(digit), modifiers: MODS.meta });
    await until("the session in the other epic", async () => (await (await fetch("http://127.0.0.1:7731/state")).json()).sessions.find((s) => s.id === "e2e-epic")?.epic === b);
    await evalIn(t, `window.wintosLayout().closeNode(window.wintosLayout().getNodeByBlockId(${JSON.stringify(pane)}).id)`);
});

await scenario("39 · each session is a row of its own; two in one view share its mark, and a click lands on that session's pane", async () => {
    const t = await toProject();
    const tabId = await evalIn(t, "window.wintosTabId()");
    const focused = () => evalIn(t, `window.wintosLayout().getter(window.wintosLayout().focusedNode)?.data?.blockId`);
    const first = await focused();
    await press(t, "d", { mods: ["meta"] });
    const second = await until("a new pane focused", async () => { const b = await focused(); return b !== first && b; });
    const api = (path, body) => fetch(`http://127.0.0.1:7731${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    await api("/events", { tabId, blockId: first, payload: { session_id: "e2e-row-a", hook_event_name: "UserPromptSubmit", prompt: "e2e row a" } });
    await api("/events", { tabId, blockId: second, payload: { session_id: "e2e-row-b", hook_event_name: "UserPromptSubmit", prompt: "e2e row b" } });
    const row = (id) => `document.querySelector("[data-wintos=sidebar-list] [data-row='s:${id}']")`;
    await until("a row for each session", () => evalIn(t, `!!${row("e2e-row-a")} && !!${row("e2e-row-b")}`));
    if (!(await evalIn(t, `${row("e2e-row-a")}.innerText.includes("⧉") || !!${row("e2e-row-a")}.querySelector("[data-wintos=row-view]")`))) throw new Error("no view mark on a row sharing its view");
    await evalIn(t, `${row("e2e-row-a")}.click()`);
    await until("the first session's pane focused", async () => (await focused()) === first);
    await evalIn(t, `window.wintosLayout().closeNode(window.wintosLayout().getNodeByBlockId(${JSON.stringify(second)}).id)`);
});

await scenario("40 · ⌥⌘T takes a session out into a view of its own: its pane closes here and resumes in a new tab; at work, it stays", async () => {
    const t = await toProject();
    const tabId = await evalIn(t, "window.wintosTabId()");
    const first = await evalIn(t, `window.wintosLayout().getter(window.wintosLayout().focusedNode)?.data?.blockId`);
    await press(t, "d", { mods: ["meta"] });
    const pane = await until("a new pane focused", async () => { const b = await evalIn(t, `window.wintosLayout().getter(window.wintosLayout().focusedNode)?.data?.blockId`); return b !== first && b; });
    const resumable = () => sql(`select count(*) from db_block where data->>'$.meta."cmd:initscript"' like '%e2e-move%'`) === "1";
    await until("a terminal", () => evalIn(t, `!!document.querySelector("[data-blockid='${pane}'] .xterm-helper-textarea")`));
    await sleep(2500);
    for (let i = 0; i < 4 && !resumable(); i++) {
        await cdpFocus(t, `[data-blockid='${pane}'] .xterm-helper-textarea`);
        await cdp(t, "Input.insertText", { text: `wsh setmeta -b this "cmd:initscript=cd '/tmp' && claude --resume 'e2e-move'"` });
        await press(t, "Enter", { keyCode: 13 });
        await until("the resume command on the pane", resumable, 4000).catch(() => {});
    }
    await until("the resume command on the pane", resumable, 1000);
    const post = (hook_event_name) => fetch("http://127.0.0.1:7731/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tabId, blockId: pane, payload: { session_id: "e2e-move", hook_event_name, prompt: "e2e move" } }) });
    await post("UserPromptSubmit");
    await sleep(800);
    await press(t, "t", { code: "KeyT", mods: ["meta", "alt"] });
    await until("the refusal while it works", () => evalIn(t, `!!document.querySelector("[data-wintos=move-refused]")`));
    await press(t, "Escape", { code: "Escape", keyCode: 27 });
    await post("Stop");
    await sleep(800);
    const tabs = () => Number(sql(`select count(*) from db_tab`));
    const before = tabs();
    await press(t, "t", { code: "KeyT", mods: ["meta", "alt"] });
    await until("a new tab resuming it", () => tabs() > before && sql(`select count(*) from db_tab t, json_each(t.data->'blockids') j, db_block b where t.oid!='${tabId}' and b.oid=j.value and b.data->>'$.meta."cmd:initscript"' like '%e2e-move%'`) === "1", 20000);
    await until("its pane gone from here", () => sql(`select count(*) from db_tab t, json_each(t.data->'blockids') j where t.oid='${tabId}' and j.value='${pane}'`) === "0");
});

await scenario("41 · ⇧⌘Y is the epics home: a card per epic, the one waiting on you first; ⏎ opens its page; the rail shows its mine.md", async () => {
    const t = await toProject();
    const tabId = await evalIn(t, "window.wintosTabId()");
    const pane = await evalIn(t, `window.wintosLayout().getter(window.wintosLayout().focusedNode)?.data?.blockId`);
    const api = (path, body) => fetch(`http://127.0.0.1:7731${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const id = await (await api("/epics", { title: "E2E home", short: "Home" })).text();
    await api(`/epics/${id}/mine`, { text: "- e2e epic note" });
    await api("/events", { tabId, blockId: pane, payload: { session_id: "e2e-home", hook_event_name: "UserPromptSubmit", prompt: "e2e home" } });
    await api("/events", { tabId, blockId: pane, payload: { session_id: "e2e-home", hook_event_name: "Stop" } });
    await api("/sessions/e2e-home/epic", { epic: id });
    await until("the epic's mine.md in the rail", () => evalIn(t, `document.querySelector("[data-wintos=mine-of][data-epic='${id}']")?.closest("[data-wintos=notes-rail]")?.innerText.includes("e2e epic note")`));
    await press(t, "y", { mods: ["meta", "shift"] });
    await until("its card first", () => evalIn(t, `document.querySelector("[data-wintos=today] [data-epic]")?.dataset.epic === "${id}"`));
    await press(t, "Enter", { code: "Enter", keyCode: 13 });
    await until("its page", () => evalIn(t, `document.querySelector("[data-wintos=epic-page]")?.dataset.epic === "${id}" && document.querySelector("[data-wintos=epic-page] [data-session='e2e-home']") !== null`));
    await press(t, "p", { code: "KeyP" });
    await until("pinned at the top of the sidebar, saying what waits", () => evalIn(t, `document.querySelector("[data-wintos=pinned-epics] [data-epic='${id}']")?.innerText.includes("your move")`));
    await press(t, "p", { code: "KeyP" });
    await until("unpinned", () => evalIn(t, `!document.querySelector("[data-wintos=pinned-epics] [data-epic='${id}']")`));
    await press(t, "Escape", { code: "Escape", keyCode: 27 });
});

await scenario("42 · a on an epic's page starts its agent in a view of its own; its first session becomes the agent", async () => {
    const t = await toProject();
    const api = (path, body) => fetch(`http://127.0.0.1:7731${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const id = await (await api("/epics", { title: "E2E agent", short: "Agent" })).text();
    const active = () => sql(`select data->>'activetabid' from db_workspace limit 1`);
    await press(t, "y", { mods: ["meta", "shift"] });
    await until("its card", () => evalIn(t, `!!document.querySelector("[data-wintos=today] [data-epic='${id}'] button")`));
    await evalIn(t, `document.querySelector("[data-wintos=today] [data-epic='${id}'] button").click()`);
    await until("its page", () => evalIn(t, `document.querySelector("[data-wintos=epic-page]")?.dataset.epic === "${id}"`));
    const from = active();
    await press(t, "a", { code: "KeyA" });
    await until("a new view in front", () => active() !== from);
    const tab = active();
    const first = await until("its first pane", () => sql(`select json_extract(data, '$.blockids[0]') from db_tab where oid='${tab}'`) || false);
    await api("/events", { tabId: tab, blockId: first, payload: { session_id: "e2e-agent", hook_event_name: "SessionStart" } });
    await until("the session is the epic's agent", async () => (await (await fetch("http://127.0.0.1:7731/state")).json()).epics.find((e) => e.id === id)?.agent === "e2e-agent", 20000);
});

await scenario("43 · a worker's turn end reaches its epic's agent: typed into the agent's pane once it is free, then gone from the queue", async () => {
    const t = await toProject();
    const tabId = await evalIn(t, "window.wintosTabId()");
    const pane = await evalIn(t, `window.wintosLayout().getter(window.wintosLayout().focusedNode)?.data?.blockId`);
    const api = (path, body) => fetch(`http://127.0.0.1:7731${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const st = async () => (await fetch("http://127.0.0.1:7731/state")).json();
    const id = await (await api("/epics", { title: "E2E reports" })).text();
    await api("/events", { tabId, blockId: pane, payload: { session_id: "e2e-ag", hook_event_name: "SessionStart" } });
    await api(`/epics/${id}/agent`, { sessionId: "e2e-ag" });
    // Reports wait while you are in the agent's pane: look at another one. CDP's key-up follows its
    // key-down at once and can land on the old pane's xterm, which takes focus back; a hand is slower.
    await press(t, "d", { mods: ["meta"] });
    const other = await until("a second pane", () => evalIn(t, `[...document.querySelectorAll("[data-blockid]")].map((b) => b.dataset.blockid).find((b) => b !== "${pane}") ?? false`));
    await evalIn(t, `window.wintosLayout().focusNode(window.wintosLayout().getNodeByBlockId("${other}").id)`);
    await until("another pane focused", async () => (await evalIn(t, `window.wintosLayout().getter(window.wintosLayout().focusedNode)?.data?.blockId`)) !== pane);
    await api("/events", { tabId: "e2e-elsewhere", blockId: "e2e-wb", payload: { session_id: "e2e-wk", hook_event_name: "UserPromptSubmit", prompt: "e2e worker" } });
    await api("/sessions/e2e-wk/epic", { epic: id });
    await api("/blocks/e2e-wb/ask", { kind: "decide", text: "merge the e2e fix?" });
    await api("/events", { tabId: "e2e-elsewhere", blockId: "e2e-wb", payload: { session_id: "e2e-wk", hook_event_name: "Stop", last_assistant_message: "Pushed the e2e fix." } });
    await until("the report queued", async () => ((await st()).epicReports?.["e2e-ag"] ?? []).length === 1);
    await until("typed into the agent and off the queue", async () => !(await st()).epicReports?.["e2e-ag"], 120_000);
});

await scenario("44 · ⌥⌘V shows the sidebar by epic: each epic with its sessions; + new session opens ⌘N's sheet on that epic; a row drops the epic it sits under; an epic with no session folds to one line with its +; ⌥⌘V again goes back", async () => {
    const t = await toProject();
    const tabId = await evalIn(t, "window.wintosTabId()");
    const pane = await evalIn(t, `window.wintosLayout().getter(window.wintosLayout().focusedNode)?.data?.blockId`);
    const api = (path, body) => fetch(`http://127.0.0.1:7731${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const id = await (await api("/epics", { title: "E2E grouped" })).text();
    await api("/events", { tabId, blockId: pane, payload: { session_id: "e2e-grouped", hook_event_name: "UserPromptSubmit", prompt: "e2e grouped" } });
    await api("/sessions/e2e-grouped/epic", { epic: id });
    await evalIn(t, `localStorage.setItem("wintos:sidebar-by-epic", "0"); window.dispatchEvent(new StorageEvent("storage"))`);
    await press(t, "v", { code: "KeyV", mods: ["meta", "alt"] });
    const group = `document.querySelector("[data-wintos=epic-groups] [data-epic-group='${id}']")`;
    await api("/sessions/e2e-grouped/name", { text: "E2E grouped: the worker" });
    await until("its group with its session, which says its state", () => evalIn(t, `!!${group}?.querySelector("[data-row='s:e2e-grouped'] [data-wintos=row-state][data-state]")`));
    await until("the row without the epic it sits under: no face, no name prefix", () => evalIn(t, `(() => { const r = ${group}.querySelector("[data-row='s:e2e-grouped']"); return r.innerText.includes("the worker") && !r.innerText.includes("E2E grouped:") && !r.querySelector("[data-epic-avatar], svg"); })()`));
    await evalIn(t, `${group}.querySelector("[data-wintos=epic-new-step]").click()`);
    await until("the sheet on that epic", () => evalIn(t, `!!document.querySelector("[data-wintos=new-step] [data-epic='${id}'][data-on]")`));
    await press(t, "Escape", { code: "Escape", keyCode: 27 });
    const bare = await (await api("/epics", { title: "E2E bare" })).text();
    const folded = `document.querySelector("[data-wintos=epic-groups-folded] [data-epic-group='${bare}'][data-folded]")`;
    await until("an epic with no session folded to one line", () => evalIn(t, `!!${folded} && !${folded}.querySelector("[data-row^='s:']")`));
    await evalIn(t, `${folded}.querySelector("[data-wintos=epic-new-step]").click()`);
    await until("its + still opens the sheet on it", () => evalIn(t, `!!document.querySelector("[data-wintos=new-step] [data-epic='${bare}'][data-on]")`));
    await press(t, "Escape", { code: "Escape", keyCode: 27 });
    await press(t, "v", { code: "KeyV", mods: ["meta", "alt"] });
    await until("back by state, where the bands say it", () => evalIn(t, `!document.querySelector("[data-wintos=epic-groups]") && !document.querySelector("[data-wintos=row-state]")`));
});

await scenario("45 · an epic's page shows its finished sessions and last 8 workdays; the month's hours on the home can be corrected", async () => {
    const t = await toProject();
    const api = (path, body) => fetch(`http://127.0.0.1:7731${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const id = await (await api("/epics", { title: "E2E history" })).text();
    const d = new Date();
    const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    await api("/time/backfill", { log: { [iso(d)]: { "e2e-old": { epic: id, ms: 3_600_000 } } } });
    await evalIn(t, `import("/wintos/ui/menu.ts").then((m) => m.openEpic("${id}"))`);
    await until("finished steps folded, eight days", () => evalIn(t, `!document.querySelector("[data-wintos=epic-page] [data-wintos=finished-step]") && !!document.querySelector("[data-wintos=epic-page] [data-more=closed]") && document.querySelectorAll("[data-wintos=epic-page] [data-wintos=epic-days] > div").length === 8 && document.activeElement?.dataset.wintos === "epic-page"`));
    await press(t, "m");
    await until("m unfolds the finished step", () => evalIn(t, `document.querySelectorAll("[data-wintos=epic-page] [data-wintos=finished-step]").length === 1`));
    await press(t, "Escape", { code: "Escape", keyCode: 27 });
    await press(t, "y", { mods: ["meta", "shift"] });
    const row = `document.querySelector("[data-wintos=month-row][data-epic='${id}']")`;
    await until("its row in the month", () => evalIn(t, `!!${row}`));
    await evalIn(t, `${row}.querySelector("button[data-act]").click()`);
    await until("the hours field", () => evalIn(t, `!!${row}.querySelector("input")`));
    await cdpFocus(t, `[data-wintos=month-row][data-epic='${id}'] input`);
    await evalIn(t, `${row}.querySelector("input").select()`);
    await cdp(t, "Input.insertText", { text: "2.5" });
    await press(t, "Enter", { code: "Enter", keyCode: 13 });
    const month = iso(d).slice(0, 7);
    await until("corrected to 2.5 h", async () => (await (await fetch(`http://127.0.0.1:7731/time/month?month=${month}`)).json()).find((r) => r.epic === id)?.ms === 9_000_000);
    // ← steps back a month (no brackets: they need ⌥ on a German or Swedish keyboard).
    const before = new Date(d.getFullYear(), d.getMonth() - 1, 1).toLocaleDateString("en-GB", { month: "long" });
    await cdpFocus(t, "[data-wintos=today]");
    await press(t, "ArrowLeft", { code: "ArrowLeft", keyCode: 37 });
    await until(`the month before (${before})`, () => evalIn(t, `document.querySelector("[data-wintos=today]")?.innerText.toLowerCase().includes(${JSON.stringify(before.toLowerCase() + " by epic")})`));
    await press(t, "y", { mods: ["meta", "shift"] });
});

await scenario("46 · on an epic's page s adds a planned step, and n offers it for a new session", async () => {
    const t = await toProject();
    const api = (path, body) => fetch(`http://127.0.0.1:7731${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const id = await (await api("/epics", { title: "E2E roadmap" })).text();
    await evalIn(t, `import("/wintos/ui/menu.ts").then((m) => m.openEpic("${id}"))`);
    await until("its page, focused", () => evalIn(t, `document.activeElement?.matches("[data-wintos=epic-page][data-epic='${id}']")`));
    await press(t, "s");
    await until("the step field", () => evalIn(t, `document.activeElement?.dataset.wintos === "epic-step-input"`));
    await cdp(t, "Input.insertText", { text: "Cutover per group" });
    await press(t, "Enter", { code: "Enter", keyCode: 13 });
    await until("on the roadmap", () => evalIn(t, `document.querySelector("[data-wintos=epic-page] [data-wintos=epic-roadmap]")?.textContent.includes("Cutover per group") && !document.querySelector("[data-wintos=epic-page] [data-wintos=epic-step-input]")`));
    await press(t, "n");
    await until("the new-step view, this epic chosen, the step offered", () => evalIn(t, `!!document.querySelector("[data-wintos=new-step] [data-epic='${id}'][data-on]") && document.querySelector("#new-step-name")?.placeholder === "Cutover per group"`));
    // ⏎ on the empty field takes the step it offers: the new session is linked to it.
    const active = () => sql(`select data->>'activetabid' from db_workspace limit 1`);
    const from = active();
    await press(t, "Enter", { code: "Enter", keyCode: 13 });
    await until("a new view in front", () => active() !== from);
    const tab = active();
    const first = await until("its first pane", () => sql(`select json_extract(data, '$.blockids[0]') from db_tab where oid='${tab}'`) || false);
    await api("/events", { tabId: tab, blockId: first, payload: { session_id: "e2e-took-step", hook_event_name: "SessionStart" } });
    await until("linked to the planned step", async () => (await (await fetch("http://127.0.0.1:7731/state")).json()).epics.find((e) => e.id === id)?.links?.["Cutover per group"]?.[0] === "e2e-took-step", 20000);
});

await scenario("47 · the roadmap worked from its rows: rename, move, done; the agent hears each edit; ⏎ starts a session linked to the step", async () => {
    const t = await toProject();
    const api = (path, body) => fetch(`http://127.0.0.1:7731${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const id = await (await api("/epics", { title: "E2E planner" })).text();
    await api(`/epics/${id}/agent`, { sessionId: "e2e-planner-agent" });
    for (const add of ["Mapping", "Cutover", "Backfill"]) await api(`/epics/${id}/roadmap`, { add });
    const steps = async () => (await (await fetch("http://127.0.0.1:7731/state")).json()).epics.find((e) => e.id === id);
    await evalIn(t, `import("/wintos/ui/menu.ts").then((m) => m.openEpic("${id}"))`);
    await until("three rows, the page focused", () => evalIn(t, `document.querySelectorAll("[data-wintos=epic-page] [data-wintos=epic-roadmap] [data-step]").length === 3 && document.activeElement?.dataset.wintos === "epic-page"`));
    await until("the cursor on Cutover", async () => (await evalIn(t, `document.querySelector("[data-wintos=epic-page] [data-cursor]")?.dataset.step === "Cutover"`)) || void (await press(t, "j")));
    await press(t, "e");
    await until("the rename field", () => evalIn(t, `document.activeElement?.dataset.wintos === "epic-step-rename"`));
    await evalIn(t, `document.activeElement.select()`);
    await cdp(t, "Input.insertText", { text: "Cutover per group" });
    await press(t, "Enter", { code: "Enter", keyCode: 13 });
    await until("renamed, and redrawn", async () => (await steps()).steps[1]?.name === "Cutover per group" && (await evalIn(t, `document.querySelector("[data-wintos=epic-page] [data-cursor]")?.dataset.step === "Cutover per group"`)));
    // Straight to the page: press() with a modifier first moves focus to the Inbox or the body.
    for (const type of ["rawKeyDown", "keyUp"]) await cdp(t, "Input.dispatchKeyEvent", { type, key: "K", code: "KeyK", windowsVirtualKeyCode: 75, modifiers: 8 });
    await until("moved up, the cursor with it", () => evalIn(t, `document.querySelector("[data-wintos=epic-page] [data-wintos=epic-roadmap] [data-step]")?.dataset.step === "Cutover per group" && document.querySelector("[data-wintos=epic-page] [data-cursor]")?.dataset.step === "Cutover per group"`));
    await press(t, "j");
    await until("the cursor on Mapping", () => evalIn(t, `document.querySelector("[data-wintos=epic-page] [data-cursor]")?.dataset.step === "Mapping"`));
    await press(t, "d");
    await until("Mapping done", async () => (await steps()).steps.find((u) => u.name === "Mapping")?.state === "done");
    const heard = (await (await fetch("http://127.0.0.1:7731/state")).json()).epicReports["e2e-planner-agent"].map((r) => r.text);
    if (heard.length !== 6 || !heard[3].includes('renamed "Cutover" to "Cutover per group"')) throw new Error(`the agent heard: ${JSON.stringify(heard)}`);
    await until("Mapping shown done", () => evalIn(t, `document.querySelector("[data-wintos=epic-page] [data-step=Mapping]")?.dataset.unit === "done"`));
    await press(t, "j");
    await until("the cursor on Backfill", () => evalIn(t, `document.querySelector("[data-wintos=epic-page] [data-cursor]")?.dataset.step === "Backfill"`));
    const active = () => sql(`select data->>'activetabid' from db_workspace limit 1`);
    const from = active();
    await press(t, "Enter", { code: "Enter", keyCode: 13 });
    await until("a new view in front", () => active() !== from);
    const tab = active();
    const first = await until("its first pane", () => sql(`select json_extract(data, '$.blockids[0]') from db_tab where oid='${tab}'`) || false);
    await api("/events", { tabId: tab, blockId: first, payload: { session_id: "e2e-backfill", hook_event_name: "SessionStart" } });
    await until("a session linked to Backfill, the step current", async () => {
        const e = await steps();
        return e.links?.Backfill?.[0] === "e2e-backfill" && e.steps.find((u) => u.name === "Backfill")?.state === "current";
    }, 20_000);
});

await scenario("48 · the epic agent's pane: the epic beside its terminal; ⌘L into it, s adds a step there, ⌘H back; from the home the epic opens here", async () => {
    // A view opened during the run has no size while the dev window is covered, and the column
    // needs a pane 700px wide: work in T2, one wide pane.
    const t1 = (await renderers()).find((x) => x.title.endsWith(" - T2"));
    const t1Tab = await evalIn(t1, "window.wintosTabId()");
    await evalIn(await visible(), `import("/wintos/ui/focus.ts").then((f) => f.focusSession({ tabId: "${t1Tab}", blockId: "" }))`);
    await until("T2 in front", () => sql(`select data->>'activetabid' from db_workspace limit 1`) === t1Tab);
    const t = await visible();
    const tabId = await evalIn(t, "window.wintosTabId()");
    const pane = await evalIn(t, `window.wintosLayout().getter(window.wintosLayout().focusedNode)?.data?.blockId`);
    const api = (path, body) => fetch(`http://127.0.0.1:7731${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const id = await (await api("/epics", { title: "E2E agent view", short: "AgentView" })).text();
    await api("/events", { tabId, blockId: pane, payload: { session_id: "e2e-viewagent", hook_event_name: "SessionStart" } });
    await api(`/epics/${id}/agent`, { sessionId: "e2e-viewagent" });
    const col = `[data-blockid='${pane}'] [data-wintos=epic-column][data-epic='${id}']`;
    await until("the epic beside the agent's terminal", () => evalIn(t, `!!document.querySelector("${col}")?.offsetParent`), 20000);
    await until("the agent's view looks like the epic itself", () => evalIn(t, `(() => { const st = document.querySelector("[data-wintos=epic-strip][data-epic='${id}']"); return st?.dataset.role === "agent" && !!st.querySelector("[data-wintos=agent-badge]") && st.innerText.includes("E2E agent view"); })()`));
    // A wide pane: two columns, the roadmap alone in the first; buttons without keycaps (⌘ held shows them).
    const layout = await evalIn(t, `(() => {
        const c = document.querySelector("${col}");
        const left = (label) => [...c.querySelectorAll("span")].find((e) => e.textContent === label)?.getBoundingClientRect().left;
        return { pane: document.querySelector("[data-blockid='${pane}'] .wintos-pane")?.getBoundingClientRect().width, roadmap: left("Roadmap"), sessions: left("Sessions"), cap: getComputedStyle(c.querySelector(".w-keycap")).display, buttons: [...c.querySelectorAll("button[data-key]")].map((b) => b.textContent.trim()) };
    })()`);
    if (layout.pane >= 1300 && !(layout.sessions > layout.roadmap + 200)) throw new Error(`not two columns, the roadmap first: ${JSON.stringify(layout)}`);
    if (layout.cap !== "none") throw new Error(`keycaps show beside the agent without ⌘: ${JSON.stringify(layout)}`);
    if (!layout.buttons.some((b) => b.endsWith("Add step"))) throw new Error(`no Add step button: ${JSON.stringify(layout)}`);
    await cdpFocus(t, `[data-blockid='${pane}'] .xterm-helper-textarea`);
    await press(t, "l", { mods: ["meta"] });
    await until("⌘L: into the column", () => evalIn(t, `document.activeElement?.matches("${col}")`));
    await press(t, "s");
    await until("the step field in the column", () => evalIn(t, `document.activeElement?.dataset.wintos === "epic-step-input"`));
    await cdp(t, "Input.insertText", { text: "Ask about the cutover" });
    await press(t, "Enter", { code: "Enter", keyCode: 13 });
    await until("on the roadmap", async () => (await (await fetch("http://127.0.0.1:7731/state")).json()).epics.find((e) => e.id === id)?.steps[0]?.name === "Ask about the cutover");
    await until("shown in the column", () => evalIn(t, `!!document.querySelector("${col} [data-step='Ask about the cutover']")`));
    await press(t, "h", { mods: ["meta"] });
    await until("⌘H: back in the agent's terminal", () => evalIn(t, `!!document.activeElement?.closest("[data-blockid='${pane}']") && !document.activeElement?.closest("[data-wintos=epic-column]")`));
    await evalIn(t, `import("/wintos/ui/menu.ts").then((m) => m.openEpic("${id}"))`);
    await until("from its own terminal, the epic stays this view", () => evalIn(t, `!document.querySelector("[data-wintos=epic-page]") && !!document.activeElement?.closest("[data-blockid='${pane}']")`));
    await press(t, "y", { mods: ["meta", "shift"] });
    await until("the epics home", () => evalIn(t, `!!document.querySelector("[data-wintos=today]")`));
    await evalIn(t, `import("/wintos/ui/menu.ts").then((m) => m.openEpic("${id}"))`);
    await until("the epic opens as its agent's pane, not a page", () => evalIn(t, `!document.querySelector("[data-wintos=today]") && !document.querySelector("[data-wintos=epic-page]") && window.wintosLayout().getter(window.wintosLayout().focusedNode)?.data?.blockId === "${pane}"`));
});

await scenario("49 · the epic agent relays your words to a session: refused unless you said them; typed in by the session's view", async () => {
    const t = await visible();
    const tabId = await evalIn(t, "window.wintosTabId()");
    const api = (path, body) => fetch(`http://127.0.0.1:7731${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const st = async () => (await fetch("http://127.0.0.1:7731/state")).json();
    const id = await (await api("/epics", { title: "E2E relay" })).text();
    await api("/events", { tabId: "e2e-elsewhere", blockId: "e2e-relay-ag", payload: { session_id: "e2e-relay-ag", hook_event_name: "SessionStart" } });
    await api(`/epics/${id}/agent`, { sessionId: "e2e-relay-ag" });
    await api("/sessions/e2e-relay-ag/epic", { epic: id });
    await api("/events", { tabId, blockId: "e2e-relay-wk", payload: { session_id: "e2e-relay-wk", hook_event_name: "UserPromptSubmit", prompt: "e2e worker" } });
    await api("/sessions/e2e-relay-wk/epic", { epic: id });
    await api("/sessions/e2e-relay-wk/name", { text: "E2E cutover check" });
    await api("/events", { tabId, blockId: "e2e-relay-wk", payload: { session_id: "e2e-relay-wk", hook_event_name: "Stop" } });
    await api("/events", { tabId: "e2e-elsewhere", blockId: "e2e-relay-ag", payload: { session_id: "e2e-relay-ag", hook_event_name: "UserPromptSubmit", prompt: "Tell it: cut over group A first" } });
    const refused = await api("/blocks/e2e-relay-ag/relay", { to: "E2E cutover", text: "cut over everything" });
    if (refused.status !== 403) throw new Error(`words you never said went through: ${refused.status}`);
    const ok = await api("/blocks/e2e-relay-ag/relay", { to: "E2E cutover", text: "cut over group A first", note: "re its cutover question" });
    if (ok.status !== 200) throw new Error(`relay refused: ${await ok.text()}`);
    await until("typed in by the session's view and off the queue", async () => !(await st()).relays?.["e2e-relay-wk"], 30000);
});

await scenario("50 · by epic, the agent is its epic's header: no row of its own, a turning ring while it works", async () => {
    const t = await visible();
    const tabId = await evalIn(t, "window.wintosTabId()");
    const api = (path, body) => fetch(`http://127.0.0.1:7731${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const id = await (await api("/epics", { title: "E2E ring" })).text();
    const pane = sql(`select json_extract(data, '$.blockids[0]') from db_tab where oid='${tabId}'`);
    await api("/events", { tabId, blockId: pane, payload: { session_id: "e2e-ring-ag", hook_event_name: "UserPromptSubmit", prompt: "e2e" } });
    await api(`/epics/${id}/agent`, { sessionId: "e2e-ring-ag" });
    await api("/sessions/e2e-ring-ag/epic", { epic: id });
    await evalIn(t, `localStorage.setItem("wintos:sidebar-by-epic", "0"); window.dispatchEvent(new StorageEvent("storage"))`);
    await press(t, "v", { code: "KeyV", mods: ["meta", "alt"] });
    const group = `document.querySelector("[data-epic-group='${id}']")`;
    await until("its heading lit: the agent's pane is where you are", () => evalIn(t, `!!${group}?.querySelector("[data-row='epic:${id}'][data-on]")`));
    await until("its group, the agent in the header, turning", () => evalIn(t, `!!${group}?.querySelector("[data-row='epic:${id}'] [data-agent-running]") && !${group}.querySelector("[data-row='s:e2e-ring-ag']") && !document.querySelector("[data-epic-group=''] [data-row='s:e2e-ring-ag']")`));
    await api("/events", { tabId, blockId: pane, payload: { session_id: "e2e-ring-ag", hook_event_name: "Stop" } });
    await until("still once it stops", () => evalIn(t, `!${group}?.querySelector("[data-agent-running]")`));
    await press(t, "v", { code: "KeyV", mods: ["meta", "alt"] });
    await until("back by state", () => evalIn(t, `!document.querySelector("[data-wintos=epic-groups]")`));
});

await scenario("51 · a click on the open pane's chip brings the keys into that pane, from wherever they were", async () => {
    const t = await toProject();
    // Chips show for a view of two panes or more.
    const first = await evalIn(t, `window.wintosLayout().getter(window.wintosLayout().focusedNode)?.data?.blockId`);
    if ((await evalIn(t, `document.querySelectorAll("[data-blockid]").length`)) === 1 && (await evalIn(t, `!!document.querySelector("[data-wintos=pane-strip] [data-pane]")`))) throw new Error("a chip for the only pane");
    await press(t, "d", { mods: ["meta"] });
    const pane = await until("a new pane focused", async () => { const b = await evalIn(t, `window.wintosLayout().getter(window.wintosLayout().focusedNode)?.data?.blockId`); return b !== first && b; });
    await until("its chip, and its terminal ready for the keys", () => evalIn(t, `!!document.querySelector("[data-pane='${pane}']") && !!document.querySelector("[data-blockid='${pane}'] textarea")`));
    await evalIn(t, `(() => { const l = document.querySelector("[data-wintos=sidebar-list]"); l.setAttribute("tabindex", "-1"); l.focus(); })()`);
    if (await evalIn(t, `!!document.activeElement?.closest("[data-blockid]")`)) throw new Error("the keys did not leave the pane");
    const at = await evalIn(t, `(() => { const b = document.querySelector("[data-pane='${pane}']").getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await cdp(t, "Input.dispatchMouseEvent", { type, ...at, button: "left", clickCount: 1 });
    await until("the keys in that pane", () => evalIn(t, `document.activeElement?.closest("[data-blockid]")?.dataset.blockid === "${pane}"`));
    await evalIn(t, `window.wintosLayout().closeNode(window.wintosLayout().getNodeByBlockId(${JSON.stringify(pane)}).id)`);
});

await scenario("52 · the epic agent starts a session for a step in the background: it shows in the epic on its step, and a click opens it in a pane", async () => {
    const t2 = (await renderers()).find((x) => x.title.endsWith(" - T2"));
    const t2Tab = await evalIn(t2, "window.wintosTabId()");
    await evalIn(await visible(), `import("/wintos/ui/focus.ts").then((f) => f.focusSession({ tabId: "${t2Tab}", blockId: "" }))`);
    await until("T2 in front", () => sql(`select data->>'activetabid' from db_workspace limit 1`) === t2Tab);
    const t = await visible();
    const pane = await evalIn(t, `window.wintosLayout().getter(window.wintosLayout().focusedNode)?.data?.blockId`);
    const api = (path, body) => fetch(`http://127.0.0.1:7731${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const id = await (await api("/epics", { title: "E2E background", short: "Bg" })).text();
    await api("/events", { tabId: t2Tab, blockId: pane, payload: { session_id: "e2e-bg-agent", hook_event_name: "SessionStart" } });
    await api(`/epics/${id}/agent`, { sessionId: "e2e-bg-agent" });
    await api("/sessions/e2e-bg-agent/epic", { epic: id });
    await api(`/epics/${id}/roadmap`, { add: "Seed the routines" });
    const started = await api(`/blocks/${pane}/start`, { step: "Seed", bgId: "52e2e52e" });
    if (started.status !== 200) throw new Error(`start refused: ${await started.text()}`);
    writeFileSync(join(process.env.HOME, ".local/share/wintos-dev/bg-agents.json"), JSON.stringify([{ id: "52e2e52e", sessionId: "52e2e52e-0000-4000-8000-000000000052", kind: "background", state: "working", status: "busy" }]));
    const col = `[data-blockid='${pane}'] [data-wintos=epic-column][data-epic='${id}']`;
    await until("in the epic, in the background, on its step", () => evalIn(t, `(() => { const c = document.querySelector("${col}"); return !!c && c.innerText.includes("background · running") && c.querySelector("[data-step='Seed the routines']")?.innerText.includes("running"); })()`), 30000);
    // Blocked on you: a card in Your move, and ⌃⇥ stops there.
    writeFileSync(join(process.env.HOME, ".local/share/wintos-dev/bg-agents.json"), JSON.stringify([{ id: "52e2e52e", sessionId: "52e2e52e-0000-4000-8000-000000000052", kind: "background", state: "blocked" }]));
    await until("in Your move", () => evalIn(t, `!!document.querySelector("[data-band-group=needs] [data-row='bg:52e2e52e-0000-4000-8000-000000000052']")`), 30000);
    // Opened in a view of its own, never as a split of the view in front (T2 here, another epic's).
    const panes = () => sql(`select json_array_length(data->'blockids') from db_tab where oid='${t2Tab}'`);
    const before = Number(panes());
    await evalIn(t, `document.querySelector("[data-row='bg:52e2e52e-0000-4000-8000-000000000052']")?.click()`);
    const own = await until("a view of its own attached to it", async () => (await (await fetch("http://127.0.0.1:7731/state")).json()).sessions.find((x) => x.id === "52e2e52e-0000-4000-8000-000000000052" && x.attachedTo)?.tabId ?? false, 30000);
    if (own === t2Tab || Number(panes()) !== before) throw new Error(`it opened in the view in front (${own})`);
});

await scenario("53 · ⌥⌘T moves a background session attached as a split into a view of its own, also while it works", async () => {
    const t2 = (await renderers()).find((x) => x.title.endsWith(" - T2"));
    const t2Tab = await evalIn(t2, "window.wintosTabId()");
    await evalIn(await visible(), `import("/wintos/ui/focus.ts").then((f) => f.focusSession({ tabId: "${t2Tab}", blockId: "" }))`);
    await until("T2 in front", () => sql(`select data->>'activetabid' from db_workspace limit 1`) === t2Tab);
    const t = await visible();
    const agentPane = await evalIn(t, `window.wintosLayout().getter(window.wintosLayout().focusedNode)?.data?.blockId`);
    const api = (path, body) => fetch(`http://127.0.0.1:7731${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const st = async () => (await fetch("http://127.0.0.1:7731/state")).json();
    const id = await (await api("/epics", { title: "E2E move bg", short: "MoveBg" })).text();
    await api("/events", { tabId: t2Tab, blockId: agentPane, payload: { session_id: "e2e-mv-agent", hook_event_name: "SessionStart" } });
    await api(`/epics/${id}/agent`, { sessionId: "e2e-mv-agent" });
    await api("/sessions/e2e-mv-agent/epic", { epic: id });
    await api(`/epics/${id}/roadmap`, { add: "Move me" });
    await api(`/blocks/${agentPane}/start`, { step: "Move", bgId: "53e2e53e" });
    const sid = "53e2e53e-0000-4000-8000-000000000053";
    writeFileSync(join(process.env.HOME, ".local/share/wintos-dev/bg-agents.json"), JSON.stringify([{ id: "53e2e53e", sessionId: sid, kind: "background", state: "working", status: "busy" }]));
    await until("listed", async () => (await st()).sessions.some((x) => x.id === sid), 30000);
    // Attached as a split of T2, the way the old build opened it.
    await evalIn(t, `import("/frontend/app/store/global.ts").then((g) => g.createBlock({ meta: { view: "term", controller: "shell", "cmd:initscript": "claude attach 53e2e53e" } }))`);
    const pane = await until("attached in T2", async () => { const x = (await st()).sessions.find((y) => y.id === sid); return x?.tabId === t2Tab && x.attachedTo; }, 20000);
    await evalIn(t, `window.wintosLayout().focusNode(window.wintosLayout().getNodeByBlockId("${pane}").id)`);
    await until("its pane focused", () => evalIn(t, `window.wintosLayout().getter(window.wintosLayout().focusedNode)?.data?.blockId === "${pane}"`));
    await press(t, "t", { code: "KeyT", mods: ["meta", "alt"] });
    await until("in a view of its own, gone from T2", async () => { const x = (await st()).sessions.find((y) => y.id === sid); return x?.tabId !== t2Tab && x?.attachedTo && !sql(`select data->>'blockids' from db_tab where oid='${t2Tab}'`).includes(pane); }, 30000);
});

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

await scenario("54 · ⌥⌘E, a name and ⌘⏎ promote a session in no epic to the agent of a new epic: its pane shows the epic, and its first report says so", async () => {
    const t = await toProject();
    const tabId = await evalIn(t, "window.wintosTabId()");
    const api = (path, body) => fetch(`http://127.0.0.1:7731${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const first = await evalIn(t, `window.wintosLayout().getter(window.wintosLayout().focusedNode)?.data?.blockId`);
    await press(t, "d", { mods: ["meta"] });
    const pane = await until("a new pane focused", async () => { const b = await evalIn(t, `window.wintosLayout().getter(window.wintosLayout().focusedNode)?.data?.blockId`); return b !== first && b; });
    await api("/events", { tabId, blockId: pane, payload: { session_id: "e2e-promo", hook_event_name: "UserPromptSubmit", prompt: "e2e promo" } });
    await until("its session known", async () => !!(await (await fetch("http://127.0.0.1:7731/state")).json()).sessions.find((s) => s.id === "e2e-promo"));
    await press(t, "e", { code: "KeyE", mods: ["meta", "alt"] });
    await until("the epic picker, offering the promotion", () => evalIn(t, `!!document.querySelector("[data-wintos=epic-picker] [data-wintos=epic-promote]")`));
    await cdp(t, "Input.insertText", { text: "E2E promoted" });
    for (const type of ["rawKeyDown", "keyUp"]) await cdp(t, "Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers: MODS.meta });
    const st = async () => (await fetch("http://127.0.0.1:7731/state")).json();
    const epic = await until("a new epic with the session as its agent", async () => (await st()).epics.find((e) => e.title === "E2E promoted" && e.agent === "e2e-promo"));
    await until("the session in it, told in a report", async () => { const x = await st(); return x.sessions.find((s) => s.id === "e2e-promo")?.epic === epic.id && (x.epicReports?.["e2e-promo"] ?? []).some((r) => r.text.includes("agent of the new epic")); });
    await until("the strip over its pane is the agent's", () => evalIn(t, `document.querySelector("[data-wintos=epic-strip][data-epic='${epic.id}']")?.dataset.role === "agent"`));
    await evalIn(t, `window.wintosLayout().closeNode(window.wintosLayout().getNodeByBlockId(${JSON.stringify(pane)}).id)`);
});

await scenario("55 · r on an epic's page renames it in place: title and short name; esc leaves them", async () => {
    const t = await toProject();
    const api = (path, body) => fetch(`http://127.0.0.1:7731${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const id = await (await api("/epics", { title: "E2E old name" })).text();
    await evalIn(t, `import("/wintos/ui/menu.ts").then((m) => m.openEpic("${id}"))`);
    await until("its page", () => evalIn(t, `document.querySelector("[data-wintos=epic-page]")?.dataset.epic === "${id}" && !!document.querySelector("[data-wintos=epic-page] [data-wintos=epic-rename]")`));
    await press(t, "r");
    await until("the title field", () => evalIn(t, `!!document.querySelector("[data-wintos=epic-retitle] input")`));
    await cdpFocus(t, "[data-wintos=epic-retitle] input");
    await evalIn(t, `document.querySelector("[data-wintos=epic-retitle] input").select()`);
    await cdp(t, "Input.insertText", { text: "E2E new name" });
    await cdpFocus(t, "[data-wintos=epic-retitle] input + input");
    await cdp(t, "Input.insertText", { text: "New" });
    for (const type of ["rawKeyDown", "keyUp"]) await cdp(t, "Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await until("renamed, its id kept", async () => { const e = (await (await fetch("http://127.0.0.1:7731/state")).json()).epics.find((x) => x.id === id); return e?.title === "E2E new name" && e.short === "New"; });
    await until("the page shows it", () => evalIn(t, `document.querySelector("[data-wintos=epic-page] h1")?.innerText === "E2E new name"`));
    await press(t, "r");
    await until("the field again", () => evalIn(t, `!!document.querySelector("[data-wintos=epic-retitle] input")`));
    await cdpFocus(t, "[data-wintos=epic-retitle] input");
    await cdp(t, "Input.insertText", { text: " typo" });
    for (const type of ["rawKeyDown", "keyUp"]) await cdp(t, "Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await until("esc leaves it", () => evalIn(t, `!document.querySelector("[data-wintos=epic-retitle]")`));
    if ((await (await fetch("http://127.0.0.1:7731/state")).json()).epics.find((x) => x.id === id)?.title !== "E2E new name") throw new Error("esc changed the title");
    await press(t, "Escape", { code: "Escape", keyCode: 27 });
});

clearInterval(heldTimer);
for (const r of results) console.log(r.join("  "));
process.exit(results.some((r) => r[0] === "FAIL") ? 1 : 0);
