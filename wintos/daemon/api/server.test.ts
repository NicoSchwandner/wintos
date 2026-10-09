import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import type { AddressInfo } from "net";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import WebSocket from "ws";
import prompt from "../fixtures/user-prompt-submit.json";
import stop from "../fixtures/stop.json";
import { startServer, WintosServer } from "./server";

let srv: WintosServer;
let base: string;
let root: string;

beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "wintos-api-"));
    srv = await startServer({ root, port: 0, token: "t0ken" });
    base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
});
afterEach(() => srv.close());

const JSON_HEADERS = { "Content-Type": "application/json" };
const post = (path: string, body: unknown, headers: Record<string, string> = JSON_HEADERS) =>
    fetch(base + path, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
const event = (payload: object, tabId = "tab-1") => post("/events", { tabId, blockId: "blk-1", payload });

describe("wintosd API", () => {
    test("`wintos status` sets the session's line, shown in /state", async () => {
        await event(prompt);
        expect((await post("/blocks/blk-1/status", { text: "Walking the test plan" })).status).toBe(200);
        const state = await (await fetch(base + "/state")).json();
        expect(state.sessions[0].status).toEqual({ text: "Walking the test plan", at: expect.any(Number) });
        expect((await post("/blocks/blk-1/status", { text: "a\nb" })).status).toBe(400);
    });

    test("`wintos wait` then Stop parks the session on what it waits for", async () => {
        await event(prompt);
        expect((await post("/blocks/blk-1/wait", { reason: "CI on #1479" })).status).toBe(200);
        await event(stop);
        const state = await (await fetch(base + "/state")).json();
        expect(state.sessions).toEqual([expect.objectContaining({ state: "parked", parkedOn: "CI on #1479" })]);
    });

    test("`wintos done` then Stop ends the session done", async () => {
        await event(prompt);
        expect((await post("/blocks/blk-1/done", {})).status).toBe(200);
        await event(stop);
        const state = await (await fetch(base + "/state")).json();
        expect(state.sessions).toEqual([expect.objectContaining({ state: "done" })]);
    });

    test("wait needs a one-line reason", async () => {
        expect((await post("/blocks/blk-1/wait", { reason: "a\nb" })).status).toBe(400);
        expect((await post("/blocks/blk-1/wait", {})).status).toBe(400);
    });

    test("a Stop shows up in /state as a waiting session", async () => {
        await event(stop);
        const state = await (await fetch(base + "/state")).json();
        expect(state.sessions).toEqual([expect.objectContaining({ tabId: "tab-1", state: "waiting" })]);
    });

    test("the prompt injection asks for a title only while there is none", async () => {
        const first = await (await event(prompt)).text();
        expect(first).toContain('wintos title "');
        await post("/projects/tab-1/title", { title: "Invoice OCR", manual: false });
        const second = await (await event(prompt)).text();
        expect(second).not.toContain('wintos title "');
        expect(second).toContain(join(root, "invoice-ocr", "project.md"));
    });

    test("an edited mine.md leads the next injection with its diff", async () => {
        await post("/projects/tab-1/title", { title: "X", manual: false });
        writeFileSync(join(root, "x", "mine.md"), "ceiling: two vendors\n");
        await event(prompt);
        writeFileSync(join(root, "x", "mine.md"), "ceiling: one vendor\n");
        const text = await (await event(prompt)).text();
        expect(text.indexOf("mine.md changed since your last prompt")).toBeGreaterThan(-1);
        expect(text.indexOf("mine.md changed")).toBeLessThan(text.indexOf("project.md"));
        expect(text).toContain("- ceiling: two vendors\n+ ceiling: one vendor");
    });

    test("non-prompt events answer with an empty body", async () => {
        expect(await (await event(stop)).text()).toBe("");
    });

    test("the websocket pushes state after an event", async () => {
        const ws = new WebSocket(base.replace("http", "ws") + "/ws?token=t0ken", { origin: "http://localhost:5173" });
        const frames: string[] = [];
        await new Promise<void>((resolve) => ws.on("message", (m) => (frames.push(String(m)), frames.length === 1 && resolve())));
        await event(stop);
        await new Promise((r) => setTimeout(r, 50));
        expect(JSON.parse(frames[frames.length - 1]).sessions[0].state).toBe("waiting");
        ws.close();
    });

    test("bad input is a 400 and the server stays up", async () => {
        expect((await post("/events", "{nope")).status).toBe(400);
        expect((await post("/events", { tabId: "t" })).status).toBe(400);
        expect((await fetch(base + "/state")).status).toBe(200);
    });

    test("a manual title from the UI locks it", async () => {
        await post("/projects/tab-1/title", { title: "Mine", manual: true });
        await post("/projects/tab-1/title", { title: "Claude's", manual: false });
        const state = await (await fetch(base + "/state")).json();
        expect(state.projects[0]).toMatchObject({ title: "Mine", titleLocked: true });
    });

    test("responses allow the renderer's origin, and only it", async () => {
        const ok = await fetch(base + "/state", { headers: { Origin: "http://localhost:5173", "X-Wintos-Token": "t0ken" } });
        expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    });
});

describe("search and reopen", () => {
    test("GET texts gives every project's notes and mine.md, for the palette's search", async () => {
        await post("/projects/tab-1/title", { title: "X", manual: false });
        await post("/projects/tab-2/title", { title: "Y", manual: false });
        writeFileSync(join(root, "x", "mine.md"), "rules\n");
        const t = await (await fetch(base + "/projects/texts")).json();
        expect(t).toEqual({ "tab-1": { body: "", mine: "rules\n" }, "tab-2": { body: "", mine: "" } });
    });

    test("reopening a closed project binds its folder to the new tab", async () => {
        await post("/projects/tab-old/title", { title: "X", manual: false });
        expect((await post("/projects/tab-old/reopen", { tabId: "tab-new" })).status).toBe(200);
        const n = await (await fetch(base + "/projects/tab-new/notes")).json();
        expect(n.dir).toBe(join(root, "x"));
        expect(require("fs").readFileSync(join(root, "x", "project.md"), "utf8")).toContain("id: tab-new");
        expect((await fetch(base + "/projects/tab-old/notes")).status).toBe(404);
    });

    test("reopen refuses an unknown project, and a tab that already has one", async () => {
        await post("/projects/tab-1/title", { title: "X", manual: false });
        await post("/projects/tab-2/title", { title: "Y", manual: false });
        expect((await post("/projects/nope/reopen", { tabId: "tab-3" })).status).toBe(404);
        expect((await post("/projects/tab-1/reopen", { tabId: "tab-2" })).status).toBe(409);
    });
});

describe("the keyboard game", () => {
    test("keys and clicks are scored, kept across a restart, and in the state", async () => {
        for (const kind of ["key", "key", "click"]) expect((await post("/keyboard", { kind, key: "⌘J" })).status).toBe(200);
        srv.close();
        srv = await startServer({ root, port: 0, token: "t0ken" });
        base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
        const k = (await (await fetch(base + "/state")).json()).keyboard;
        expect([k.points, k.streak, k.keys["⌘J"], k.clicks["⌘J"]]).toEqual([1, 0, 2, 1]);
    });

    test("anything else is refused", async () => expect((await post("/keyboard", { kind: "scroll", key: "x" })).status).toBe(400));
});

describe("the day", () => {
    const withJournal = async () => {
        srv.close();
        const dir = join(root, "journal");
        mkdirSync(dir);
        writeFileSync(join(root, "tpl.md"), "# $date\n\n## Today's focus (1-3 items)\n\n- [ ] ...\n");
        const { Journal } = await import("../journal/journal");
        srv = await startServer({ root, port: 0, token: "t0ken", journal: new Journal(dir, join(root, "tpl.md"), join(root, ".day-planned.json")), lunch: "11:30-13:00" });
        base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
    };

    test("the state carries today's plan and the lunch break; saving and planning update it", async () => {
        await withJournal();
        const day = async () => (await (await fetch(base + "/state")).json()) as { day: { focus: string; planned: boolean }; lunch: string };
        expect([(await day()).day.focus, (await day()).day.planned, (await day()).lunch]).toEqual(["", false, "11:30-13:00"]);
        expect((await post("/day/focus", { text: "- [ ] Pair on the flaky test" })).status).toBe(200);
        expect((await post("/day/planned", {})).status).toBe(200);
        expect([(await day()).day.focus, (await day()).day.planned]).toEqual(["- [ ] Pair on the flaky test", true]);
    });

    test("an edit to the journal outside WintOS is pushed to the windows", async () => {
        srv.close();
        const dir = mkdtempSync(join(tmpdir(), "wintos-journal-"));
        const { Journal } = await import("../journal/journal");
        srv = await startServer({ root, port: 0, token: "t0ken", journal: new Journal(dir, join(root, "tpl.md"), join(root, ".day-planned.json")) });
        base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
        const ws = new WebSocket(base.replace("http", "ws") + "/ws?token=t0ken", { origin: "http://localhost:5173" });
        let first: () => void;
        const connected = new Promise<void>((r) => (first = r));
        const pushed = new Promise<string>((resolve) => ws.on("message", (m) => (first(), String(m).includes("Edited elsewhere") && resolve(String(m)))));
        await connected;
        const d = new Date();
        const ymd = [String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")];
        mkdirSync(join(dir, ymd[0], ymd[1]), { recursive: true });
        writeFileSync(join(dir, ymd[0], ymd[1], `${ymd.join("-")}.md`), "# Today\n\n## Today's focus (1-3 items)\n\n- [ ] Edited elsewhere\n");
        expect(JSON.parse(await pushed).day.focus).toBe("- [ ] Edited elsewhere");
        ws.close();
    });

    test("without a journal the day endpoints say how to get one", async () => expect((await post("/day/focus", { text: "x" })).status).toBe(404));
});

describe("notes", () => {
    test("GET notes returns project.md's body and mine.md", async () => {
        await post("/projects/tab-1/title", { title: "X", manual: false });
        writeFileSync(join(root, "x", "mine.md"), "## Ceiling\ntwo vendors\n");
        const n = await (await fetch(base + "/projects/tab-1/notes")).json();
        expect(n).toMatchObject({ dir: join(root, "x"), projectMd: "", mine: "## Ceiling\ntwo vendors\n" });
    });

    test("saving mine.md writes the file in the project folder", async () => {
        await post("/projects/tab-1/title", { title: "X", manual: false });
        expect((await post("/projects/tab-1/mine", { text: "## Promised\nmetric\n" })).status).toBe(200);
        expect(require("fs").readFileSync(join(root, "x", "mine.md"), "utf8")).toBe("## Promised\nmetric\n");
    });

    test("a save based on an older mine.md is refused, never overwriting an outside edit", async () => {
        await post("/projects/tab-1/title", { title: "X", manual: false });
        writeFileSync(join(root, "x", "mine.md"), "v1\n");
        const n = await (await fetch(base + "/projects/tab-1/notes")).json();
        await new Promise((r) => setTimeout(r, 20));
        writeFileSync(join(root, "x", "mine.md"), "edited in my editor\n");
        expect((await post("/projects/tab-1/mine", { text: "from WintOS\n", baseMtime: n.mineMtime })).status).toBe(409);
        expect(require("fs").readFileSync(join(root, "x", "mine.md"), "utf8")).toBe("edited in my editor\n");
    });

    test("a save based on the current mine.md goes through", async () => {
        await post("/projects/tab-1/title", { title: "X", manual: false });
        writeFileSync(join(root, "x", "mine.md"), "v1\n");
        const n = await (await fetch(base + "/projects/tab-1/notes")).json();
        expect((await post("/projects/tab-1/mine", { text: "v2\n", baseMtime: n.mineMtime })).status).toBe(200);
    });

    test("mine.md's mtime is in state, so the UI refetches after an outside edit", async () => {
        await post("/projects/tab-1/title", { title: "X", manual: false });
        writeFileSync(join(root, "x", "mine.md"), "v1\n");
        let m;
        for (let i = 0; i < 40 && !m; i++) (m = (await (await fetch(base + "/state")).json()).projects[0].mineMtime) || (await new Promise((r) => setTimeout(r, 50)));
        expect(m).toBeGreaterThan(0);
    });

    test("a tab without a project has no notes to read or write", async () => {
        expect((await fetch(base + "/projects/nope/notes")).status).toBe(404);
        expect((await post("/projects/nope/mine", { text: "x" })).status).toBe(404);
    });

    test("mine.md must be a string", async () => {
        await post("/projects/tab-1/title", { title: "X", manual: false });
        expect((await post("/projects/tab-1/mine", { text: 5 })).status).toBe(400);
    });
});

describe("plugins", () => {
    test("results appear in state and r re-runs a plugin", async () => {
        srv.close();
        const dir = mkdtempSync(join(tmpdir(), "wintos-p-"));
        const f = join(dir, "count");
        writeFileSync(f, `#!/bin/sh\nn=$(cat "$0.n" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$0.n"; echo "{\\"n\\":$n}"\n`, { mode: 0o755 });
        srv = await startServer({ root, port: 0, token: "t0ken", plugins: [{ name: "count", cmd: [f], everyMs: 0 }] });
        base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
        let first;
        for (let i = 0; i < 50 && !first; i++) (first = (await (await fetch(base + "/state")).json()).plugins.count) || (await new Promise((r) => setTimeout(r, 50)));
        expect(first).toMatchObject({ ok: true, data: { n: 1 } });
        expect((await post("/plugins/count/run", {})).status).toBe(200);
        expect((await (await fetch(base + "/state")).json()).plugins.count.data).toEqual({ n: 2 });
        expect((await post("/plugins/nope/run", {})).status).toBe(404);
    });
});

describe("wintosd stays up", () => {
    test("when a reload fails (a folder where project.md should be a file)", async () => {
        await post("/projects/tab-1/title", { title: "X", manual: false });
        rmSync(join(root, "x", "project.md"));
        mkdirSync(join(root, "x", "project.md"));
        await new Promise((r) => setTimeout(r, 400));
        expect((await fetch(base + "/state")).status).toBe(200);
    });
});

describe("wintosd refuses anything but the hook and the WintOS UI", () => {
    test("a page on the UI's own origin without the launch token is refused (any Vite dev server is localhost:5173)", async () => {
        const r = await fetch(base + "/state", { headers: { Origin: "http://localhost:5173" } });
        expect(r.status).toBe(403);
    });

    test("the UI with the launch token gets in", async () => {
        const r = await fetch(base + "/state", { headers: { Origin: "http://localhost:5173", "X-Wintos-Token": "t0ken" } });
        expect(r.status).toBe(200);
    });

    test("the websocket needs the token too", async () => {
        const open = (q: string) => new Promise((resolve) => { const ws = new WebSocket(base.replace("http", "ws") + "/ws" + q, { origin: "http://localhost:5173" }); ws.on("unexpected-response", (_q, res) => resolve(res.statusCode)); ws.on("open", () => (ws.close(), resolve("opened"))); });
        expect(await open("")).toBe(403);
        expect(await open("?token=t0ken")).toBe("opened");
    });

    test("a foreign web page cannot read state", async () => {
        const r = await fetch(base + "/state", { headers: { Origin: "https://evil.example" } });
        expect(r.status).toBe(403);
        expect(r.headers.get("access-control-allow-origin")).toBeNull();
    });

    test("a foreign web page cannot post, even as a simple text/plain request", async () => {
        const r = await post("/events", { tabId: "t", blockId: "b", payload: { hook_event_name: "Stop", session_id: "s" } }, { "Content-Type": "text/plain", Origin: "https://evil.example" });
        expect(r.status).toBe(403);
        expect((await (await fetch(base + "/state")).json()).sessions).toEqual([]);
    });

    test("a POST that is not JSON is refused", async () => {
        const r = await post("/events", { tabId: "t" }, { "Content-Type": "text/plain" });
        expect(r.status).toBe(415);
    });

    test("DNS rebinding: a foreign Host header is refused", async () => {
        const r = await new Promise<number>((resolve) => {
            const u = new URL(base);
            require("http").get({ host: u.hostname, port: u.port, path: "/state", headers: { Host: "evil.example:7730" } }, (res: any) => resolve(res.statusCode));
        });
        expect(r).toBe(403);
    });

    test("a foreign origin cannot open the websocket", async () => {
        const ws = new WebSocket(base.replace("http", "ws") + "/ws", { origin: "https://evil.example" });
        const code = await new Promise((resolve) => (ws.on("unexpected-response", (_q, res) => resolve(res.statusCode)), ws.on("open", () => resolve("opened"))));
        expect(code).toBe(403);
    });

    test("a title cannot smuggle front matter lines", async () => {
        const r = await post("/projects/tab-1/title", { title: "Pwn\nid: other\nnext: rm -rf", manual: true });
        expect(r.status).toBe(400);
        expect((await (await fetch(base + "/state")).json()).projects).toEqual([]);
    });

    test("ids with line breaks or non-string payload fields are refused", async () => {
        expect((await post("/events", { tabId: "a\nb", blockId: "b", payload: { hook_event_name: "Stop", session_id: "s" } })).status).toBe(400);
        expect((await post("/events", { tabId: "t", blockId: "b", payload: { hook_event_name: "Stop", session_id: 7 } })).status).toBe(400);
    });

    test("a non-string prompt never becomes a label", async () => {
        await event({ ...prompt, prompt: { x: 1 } });
        expect((await (await fetch(base + "/state")).json()).sessions[0].label).toBeUndefined();
    });
});

describe("PR snoozes", () => {
    const U = "https://github.com/acme/api/pull/7";

    test("a snooze is in state and survives a restart", async () => {
        expect((await post("/prs/snooze", { url: U, until: 2e12, movedAt: "2026-09-28T08:00:00Z" })).status).toBe(200);
        expect((await (await fetch(base + "/state")).json()).snoozes).toEqual({ [U]: { until: 2e12, movedAt: "2026-09-28T08:00:00Z" } });
        await srv.close();
        srv = await startServer({ root, port: 0, token: "t0ken" });
        base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
        expect((await (await fetch(base + "/state")).json()).snoozes[U]).toBeDefined();
    });

    test("until null wakes it", async () => {
        await post("/prs/snooze", { url: U, until: 2e12, movedAt: "x" });
        await post("/prs/snooze", { url: U, until: null });
        expect((await (await fetch(base + "/state")).json()).snoozes).toEqual({});
    });

    test("anything but a PR url and a time is refused", async () => {
        expect((await post("/prs/snooze", { url: "javascript:alert(1)", until: 2e12, movedAt: "x" })).status).toBe(400);
        expect((await post("/prs/snooze", { url: U, until: "tomorrow", movedAt: "x" })).status).toBe(400);
    });
});

describe("project snoozes", () => {
    test("a snoozed project is in state and survives a restart", async () => {
        expect((await post("/projects/tab-1/snooze", { on: true })).status).toBe(200);
        expect(Object.keys((await (await fetch(base + "/state")).json()).projectSnoozes)).toEqual(["tab-1"]);
        await srv.close();
        srv = await startServer({ root, port: 0, token: "t0ken" });
        base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
        expect((await (await fetch(base + "/state")).json()).projectSnoozes["tab-1"]).toBeDefined();
    });

    test("on false wakes it", async () => {
        await post("/projects/tab-1/snooze", { on: true });
        await post("/projects/tab-1/snooze", { on: false });
        expect((await (await fetch(base + "/state")).json()).projectSnoozes).toEqual({});
    });

    test("anything but on true or false is refused", async () => {
        expect((await post("/projects/tab-1/snooze", { on: "yes" })).status).toBe(400);
    });
});

describe("sessions across a restart", () => {
    test("a session waiting on you at quit is still shown waiting, marked not started", async () => {
        await post("/events", { tabId: "tab-1", blockId: "blk-1", payload: { hook_event_name: "Stop", session_id: "s-1" } });
        srv.close();
        srv = await startServer({ root, port: 0, token: "t0ken" });
        base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
        const { sessions } = await (await fetch(base + "/state")).json();
        expect(sessions).toMatchObject([{ id: "s-1", state: "waiting", restored: true }]);
    });
});

describe("seen", () => {
    const seenOf = async () => (await (await fetch(base + "/state")).json()).seen["tab-1"];

    test("the UI marks a project seen; it survives a restart", async () => {
        expect((await post("/projects/tab-1/seen", {})).status).toBe(200);
        const at = await seenOf();
        expect(at).toBeGreaterThan(0);
        srv.close();
        srv = await startServer({ root, port: 0, token: "t0ken" });
        base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
        expect(await seenOf()).toBe(at);
    });

    test("prompting a session means you read what came before", async () => {
        await event(prompt);
        expect(await seenOf()).toBeGreaterThan(0);
    });
});

describe("the daily recap", () => {
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    test("a session's events note its project and transcript for the day", async () => {
        await event({ ...prompt, transcript_path: "/t/s.jsonl" });
        const activity = JSON.parse(readFileSync(join(root, ".activity.json"), "utf8"));
        expect(activity[iso(new Date())]["tab-1"]).toMatchObject({ prompts: 1, sessions: { [prompt.session_id]: "/t/s.jsonl" } });
    });

    test("the last worked day before today, one bullet per project from its recap", async () => {
        const day = "2026-10-06";
        const transcript = join(root, "t.jsonl");
        writeFileSync(transcript, JSON.stringify({ timestamp: `${day}T15:00:00Z`, type: "system", subtype: "away_summary", content: "We merged the two lanes. Next, rerun it." }));
        writeFileSync(join(root, ".activity.json"), JSON.stringify({ [day]: { "tab-1": { title: "Idea skill", prompts: 3, sessions: { s: transcript } } } }));
        srv.close();
        srv = await startServer({ root, port: 0, token: "t0ken" });
        base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
        expect(await (await fetch(base + "/day/recap")).json()).toEqual({ date: day, bullets: ["Idea skill: We merged the two lanes."] });
    });
});

describe("the shelf", () => {
    const script = (id: string) => `cd '/w' && claude --resume '${id}'`;
    const shelfOf = async () => (await (await fetch(base + "/state")).json()).shelf;

    test("a closed session is kept with its project, its label and what it was last about", async () => {
        const transcript = join(root, "t.jsonl");
        writeFileSync(transcript, JSON.stringify({ timestamp: "2026-10-06T15:00:00Z", type: "system", subtype: "away_summary", content: "We merged the two lanes. Next, rerun it." }));
        await post("/projects/tab-1/title", { title: "Idea skill", manual: true });
        await event({ ...prompt, transcript_path: transcript });
        expect((await post("/projects/tab-1/shelf", { script: script(prompt.session_id), label: "merge the lanes" })).status).toBe(200);
        expect(await shelfOf()).toEqual({ "tab-1": [expect.objectContaining({ sessionId: prompt.session_id, label: "merge the lanes", gist: "We merged the two lanes." })] });
        await post("/projects/tab-1/shelf", { script: script(prompt.session_id) });
        expect((await shelfOf())["tab-1"][0].label).toBe("We merged the two lanes.");
    });

    test("it follows the project's folder into a reopened tab, and survives a restart", async () => {
        await post("/projects/tab-1/title", { title: "Idea skill", manual: true });
        await post("/projects/tab-1/shelf", { script: script("s1"), label: "x" });
        await post("/projects/tab-1/reopen", { tabId: "tab-2" });
        srv.close();
        srv = await startServer({ root, port: 0, token: "t0ken" });
        base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
        expect(Object.keys(await shelfOf())).toEqual(["tab-2"]);
    });

    test("a session that runs again leaves the shelf", async () => {
        await post("/projects/tab-1/title", { title: "Idea skill", manual: true });
        await post("/projects/tab-1/shelf", { script: script(prompt.session_id), label: "x" });
        await event({ ...prompt, hook_event_name: "SessionStart" });
        expect(await shelfOf()).toEqual({});
    });

    test("closing its pane ends the session, and that keeps it on the shelf", async () => {
        await post("/projects/tab-1/title", { title: "Idea skill", manual: true });
        await post("/projects/tab-1/shelf", { script: script(prompt.session_id), label: "x" });
        await event({ ...prompt, hook_event_name: "SessionEnd", reason: "other" });
        expect((await shelfOf())["tab-1"]).toHaveLength(1);
    });

    test("only the hook's resume command, and only for a project", async () => {
        await post("/projects/tab-1/title", { title: "Idea skill", manual: true });
        expect((await post("/projects/tab-1/shelf", { script: "rm -rf ~", label: "x" })).status).toBe(400);
        expect((await post("/projects/tab-9/shelf", { script: script("s1"), label: "x" })).status).toBe(404);
    });
});
