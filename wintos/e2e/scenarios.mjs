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
    const list = await call("DOM.querySelector", { nodeId: root.nodeId, selector: "[data-wintos=inbox-list]" });
    const body = await call("DOM.querySelector", { nodeId: root.nodeId, selector: "body" });
    await call("DOM.focus", { nodeId: list?.nodeId || body.nodeId });
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
    let t = await visible();
    if (await inboxIn(t)) await press(t, "j", { mods: ["meta"] });
    return until("a project in front", async () => ((t = await visible()), !(await inboxIn(t)) && t));
}

// Every run starts with at least one project (the dev-only wintosAction hook creates one).
const projects = () => Number(sql(`select count(*) from db_tab where coalesce(data->>'$.meta."wintos:inbox"', 0) != 1`));
if (projects() === 0) {
    await evalIn(await visible(), `window.wintosAction("project")`);
    await until("a project", async () => projects() > 0);
}

await scenario("9 · the Inbox exists exactly once", async () => {
    const n = sql(`select count(*) from db_tab where data->>'$.meta."wintos:inbox"' = 1`);
    if (n !== "1") throw new Error(`${n} Inbox tabs`);
});

await scenario("1 · ⇧⌘G from a project shows the Inbox with its list focused, and no project renders a PR view", async () => {
    const project = await toProject();
    await press(project, "g", { mods: ["meta", "shift"] });
    const inbox = await until("the Inbox in front", async () => {
        const t = await visible();
        return (await inboxIn(t)) && t;
    });
    await until("the list focused", () => evalIn(inbox, `document.activeElement?.dataset?.wintos === "inbox-list"`));
    for (const t of await renderers()) if (t.id !== inbox.id && (await evalIn(t, `!!document.querySelector("[data-wintos=inbox-list]")`))) throw new Error(`renderer ${t.id.slice(0, 6)} renders a PR list`);
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

await scenario("4 · ⌥⌘→ moves to the next pane", async () => {
    const inbox = await visible();
    const on = () => evalIn(inbox, `document.querySelector("[data-pane][data-on]")?.dataset.pane`);
    const first = await on();
    await press(inbox, "ArrowRight", { code: "ArrowRight", keyCode: 39, mods: ["alt", "meta"] });
    await until("another pane", async () => (await on()) !== first);
});

await scenario("8 · ⇧⌘W in the Inbox leaves it open", async () => {
    const inbox = await visible();
    const before = projects();
    await press(inbox, "w", { mods: ["meta", "shift"] });
    await sleep(1500);
    if (!(await inboxIn(await visible()))) throw new Error("the Inbox is no longer in front");
    if (sql(`select count(*) from db_tab where data->>'$.meta."wintos:inbox"' = 1`) !== "1") throw new Error("the Inbox tab is gone");
    // Wave's own ⇧⌘W once shadowed WintOS's and closed a project without asking.
    if (projects() !== before) throw new Error("a project was closed");
});

for (const r of results) console.log(r.join("  "));
process.exit(results.some((r) => r[0] === "FAIL") ? 1 : 0);
