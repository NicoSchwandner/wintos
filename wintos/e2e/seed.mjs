// Seeds a freshly reset dev instance (wintos/dev-reset.sh) with three projects, T1 to T3, beside the
// PRs and On call tabs WintOS makes itself. Dev instance only (debug port 9224, daemon 7731).
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";

const PORT = 9224;
const DB = `${homedir()}/.local/share/wintos-dev/data/db/waveterm.db`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (sql) => execFileSync("sqlite3", ["-readonly", DB, sql], { encoding: "utf8" }).trim();
const projectTabs = () =>
    q("select j.value from db_workspace w, json_each(w.data->'tabids') j")
        .split("\n")
        .filter(Boolean)
        .filter((id) => !["PRs", "On call"].includes(q(`select data->>'name' from db_tab where oid='${id}'`)));
const token = execFileSync("/bin/sh", ["-c", `ps eww -p $(pgrep -f "personal/wintos/dist/wintos/wintosd.cjs" | head -1) | tr ' ' '\\n' | sed -n 's/^WINTOS_TOKEN=//p'`], { encoding: "utf8" }).trim();

async function evalActive(expression) {
    const active = q("select data->>'activetabid' from db_workspace limit 1");
    for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === "page" && t.url.includes("index.html"))) {
        const ws = new WebSocket(t.webSocketDebuggerUrl);
        await new Promise((r) => ws.addEventListener("open", r));
        const call = (expr) =>
            new Promise((r) => {
                ws.addEventListener("message", (m) => r(JSON.parse(m.data).result?.result?.value), { once: true });
                ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true, awaitPromise: true } }));
            });
        const mine = (await call("window.wintosTabId?.()")) === active;
        const v = mine ? await call(expression) : undefined;
        ws.close();
        if (mine) return v;
    }
}

// A fresh data folder opens Wave's onboarding, which switches every shortcut off: skip it, and
// reload the windows that already show it.
await evalActive(`window.wintosSkipOnboarding()`);
for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === "page" && t.url.includes("index.html"))) {
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener("open", r));
    ws.send(JSON.stringify({ id: 1, method: "Page.reload", params: {} }));
    await sleep(300);
    ws.close();
}
await sleep(5000);
const blocks = (id) => Number(q(`select json_array_length(data->'blockids') from db_tab where oid='${id}'`));
const ready = () => projectTabs().filter((id) => blocks(id) > 0);
for (let i = 0; ready().length < 3 && i < 10; i++) {
    const before = projectTabs().length;
    await evalActive(`window.wintosAction("project")`);
    for (let n = 0; n < 30 && projectTabs().length === before; n++) await sleep(300);
    await sleep(1000);
}
// A fresh install's first tab has no pane and takes no keys: it goes.
const workspace = q("select oid from db_workspace limit 1");
for (const id of projectTabs().filter((id) => blocks(id) === 0)) await evalActive(`window.api.closeTab(${JSON.stringify(workspace)}, ${JSON.stringify(id)}, false)`);
await sleep(1500);
const tabs = ready().slice(0, 3);
for (const [i, id] of tabs.entries()) {
    const res = await fetch(`http://127.0.0.1:7731/projects/${id}/title`, { method: "POST", headers: { "Content-Type": "application/json", "X-Wintos-Token": token }, body: JSON.stringify({ title: `T${i + 1}`, manual: true }) });
    if (!res.ok) throw new Error(`naming ${id} failed: ${res.status}`);
}
console.log(`seeded ${tabs.length} projects: T1-T${tabs.length}`);
