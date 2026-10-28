import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "fs";
import type { AddressInfo } from "net";
import { tmpdir } from "os";
import { dirname, join } from "path";
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
    test("⌘Z after a park: /sessions/:id/unpark makes the turn yours again", async () => {
        await event({ ...prompt, hook_event_name: "Stop" });
        await post("/blocks/blk-1/wait", { reason: "CI" });
        expect((await post(`/sessions/${prompt.session_id}/unpark`, {})).status).toBe(200);
        expect((await (await fetch(base + "/state")).json()).sessions[0]).toMatchObject({ state: "waiting" });
    });

    test("`wintos lane` then `wintos step` show in /state; an unknown step is a 400", async () => {
        await event(prompt);
        expect((await post("/blocks/blk-1/lane", { name: "fast", steps: ["Test", "Fix", "?Your OK"] })).status).toBe(200);
        expect((await post("/blocks/blk-1/step", { step: "fix" })).status).toBe(200);
        expect((await post("/blocks/blk-1/step", { step: "Deploy" })).status).toBe(400);
        expect((await post("/blocks/blk-1/lane", { name: "x", steps: [] })).status).toBe(400);
        const state = await (await fetch(base + "/state")).json();
        expect(state.sessions[0].lane).toEqual({ name: "fast", steps: ["Test", "Fix", "?Your OK"], at: 1 });
    });

    test("`wintos todo` lists the step's to-dos and ticks them; without a lane it is a 400", async () => {
        await event(prompt);
        expect((await post("/blocks/blk-1/todo", { items: ["Narrow list"] })).status).toBe(400);
        await post("/blocks/blk-1/lane", { name: "fast", steps: ["Test", "Fix"] });
        expect((await post("/blocks/blk-1/todo", { items: ["Narrow list", "Name search"] })).status).toBe(200);
        expect((await post("/blocks/blk-1/todo", { done: "name" })).status).toBe(200);
        expect((await post("/blocks/blk-1/todo", { done: "Deploy" })).status).toBe(400);
        const state = await (await fetch(base + "/state")).json();
        expect(state.sessions[0].lane.todos).toEqual([{ text: "Narrow list", done: false }, { text: "Name search", done: true }]);
    });

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
        await event({ ...stop, last_assistant_message: "" });
        const state = await (await fetch(base + "/state")).json();
        expect(state.sessions).toEqual([expect.objectContaining({ tabId: "tab-1", state: "waiting" })]);
    });

    test("`wintos ask` then Stop waits on the developer for what it asked; a bad kind is a 400", async () => {
        await event(prompt);
        expect((await post("/blocks/blk-1/ask", { kind: "ponder" })).status).toBe(400);
        expect((await post("/blocks/blk-1/ask", { kind: "decide", text: "two bands or one" })).status).toBe(200);
        await event(stop);
        const state = await (await fetch(base + "/state")).json();
        expect(state.sessions).toEqual([expect.objectContaining({ state: "waiting", ask: { kind: "decide", text: "two bands or one", by: "session" } })]);
    });

    const settled = async (until: (s: { state: string; ask?: unknown }) => boolean) => {
        for (let i = 0; i < 50; i++) {
            const s = (await (await fetch(base + "/state")).json()).sessions[0];
            if (until(s)) return s;
            await new Promise((r) => setTimeout(r, 50));
        }
        return (await (await fetch(base + "/state")).json()).sessions[0];
    };

    test("a turn that said nothing is read by the model: an ask, or done for a report", async () => {
        srv.close();
        srv = await startServer({ root, port: 0, token: "t0ken", recapCmd: `cat > ${join(root, "ask-prompt.txt")}; echo 'approve: the migration plan'` });
        base = `http://127.0.0.1:${(srv.http.address() as { port: number }).port}`;
        await event(prompt);
        await event({ ...stop, last_assistant_message: "Here is the plan. Go?" });
        expect(await settled((s) => !!s.ask)).toMatchObject({ state: "waiting", ask: { kind: "approve", text: "the migration plan", by: "model" } });
        expect(readFileSync(join(root, "ask-prompt.txt"), "utf8")).toContain("Here is the plan. Go?");
    });

    test("when the model fails, a guess: a question asks, a report is done", async () => {
        srv.close();
        srv = await startServer({ root, port: 0, token: "t0ken", recapCmd: "exit 1" });
        base = `http://127.0.0.1:${(srv.http.address() as { port: number }).port}`;
        await event(prompt);
        await event({ ...stop, last_assistant_message: "Shall I merge it?" });
        expect(await settled((s) => !!s.ask)).toMatchObject({ state: "waiting", ask: { kind: "answer", text: "Shall I merge it?", by: "guess" } });
        await event(prompt);
        await event({ ...stop, last_assistant_message: "Merged." });
        expect(await settled((s) => s.state === "done")).toMatchObject({ state: "done" });
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
        await event({ ...stop, last_assistant_message: "Ship it?" });
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

    test("today's focus is saved tidied, its nesting kept", async () => {
        await withJournal();
        await post("/day/focus", { text: "-  [ ] Ship it\n\t- [ ] the fallback" });
        const d = (await (await fetch(base + "/state")).json()) as { day: { focus: string } };
        expect(d.day.focus).toBe("- [ ] Ship it\n  - [ ] the fallback");
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

    test("a change in the journal is handed to the journal's sync", async () => {
        srv.close();
        const dir = mkdtempSync(join(tmpdir(), "wintos-journal-"));
        const { Journal } = await import("../journal/journal");
        let changed: () => void;
        const synced = new Promise<void>((r) => (changed = r));
        writeFileSync(join(root, "tpl.md"), "# $date\n\n## Today's focus (1-3 items)\n\n- [ ] ...\n");
        srv = await startServer({ root, port: 0, token: "t0ken", journal: new Journal(dir, join(root, "tpl.md"), join(root, ".day-planned.json")), onJournalChange: () => changed() });
        base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
        expect((await post("/day/focus", { text: "- [ ] Ship it" })).status).toBe(200);
        await synced;
    });

    test("a reflection is read with its look-back and saved into the day's file", async () => {
        await withJournal();
        const file = join(root, "journal", "2026", "10", "2026-10-23.md");
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, "# Friday\n\n## Today's focus (1-3 items)\n\n- [x] Ship it\n\n## Weekly reflection - Week 43/2026\n\n- **Goals Review**\n");
        const r = await (await fetch(base + "/reflection?date=2026-10-23")).json();
        expect([r.title, r.days]).toEqual(["Weekly reflection - Week 43/2026", [{ date: "2026-10-23", focus: "- [x] Ship it", readOut: [] }]]);
        expect((await post("/reflection", { date: "2026-10-23", body: "- **Goals Review**\n  - All", baseMtime: r.mtime - 1 })).status).toBe(409);
        expect((await post("/reflection", { date: "2026-10-23", body: "- **Goals Review**\n  - All", baseMtime: r.mtime })).status).toBe(200);
        expect(readFileSync(file, "utf8").endsWith("- **Goals Review**\n  - All\n")).toBe(true);
        expect((await post("/reflection", { date: "2026-10-22", body: "x", baseMtime: 0 })).status).toBe(404);
        expect((await fetch(base + "/reflection?date=2026-10-22")).status).toBe(404);
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
        expect(require("fs").readFileSync(join(root, "x", "mine.md"), "utf8")).toBe("## Promised\n\nmetric\n");
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

describe("forgetting shelved sessions", () => {
    test("/shelf/forget takes them off the shelf; anything but session ids is refused", async () => {
        await post("/projects/tab-1/title", { title: "Idea skill", manual: true });
        await post("/projects/tab-1/shelf", { script: `cd '/w' && claude --resume 'dead'`, label: "x" });
        await post("/projects/tab-1/shelf", { script: `cd '/w' && claude --resume 'kept'`, label: "y" });
        expect((await post("/shelf/forget", { sessionIds: ["dead"] })).status).toBe(200);
        expect((await (await fetch(base + "/state")).json()).shelf["tab-1"].map((i: { sessionId: string }) => i.sessionId)).toEqual(["kept"]);
        expect((await post("/shelf/forget", { sessionIds: "dead" })).status).toBe(400);
    });
});

describe("rebuilding PR ownership", () => {
    test("/prs/owners moves each PR to its owner, live or shelved, or to nobody; anything else is refused", async () => {
        const A = "https://github.com/o/r/pull/1", B = "https://github.com/o/r/pull/2";
        await post("/projects/tab-1/title", { title: "Idea skill", manual: true });
        await event(prompt);
        await event({ hook_event_name: "PostToolUse", session_id: prompt.session_id, prs: [A, B] });
        await post("/projects/tab-1/shelf", { script: `cd '/w' && claude --resume 'z'`, label: "x" });
        expect((await post("/prs/owners", { owners: { [A]: "z", [B]: null } })).status).toBe(200);
        const st = await (await fetch(base + "/state")).json();
        expect([st.sessions[0].prs, st.shelf["tab-1"][0].prs]).toEqual([[], [A]]);
        expect((await post("/prs/owners", { owners: { "rm -rf": "z" } })).status).toBe(400);
    });
});

describe("a session's name", () => {
    const state = async () => (await (await fetch(base + "/state")).json());
    const id = prompt.session_id;

    test("the session names itself, you rename it, and its next one waits as a suggestion you can take", async () => {
        await event(prompt);
        expect((await post(`/blocks/blk-1/name?session=${id}`, { text: "Retention backfill" })).status).toBe(200);
        expect((await state()).sessions[0].name).toMatchObject({ text: "Retention backfill", by: "session" });
        await post(`/sessions/${id}/name`, { text: "My own" });
        await post(`/blocks/blk-1/name?session=${id}`, { text: "Its next" });
        expect((await state()).sessions[0].name).toMatchObject({ text: "My own", by: "you", suggested: "Its next" });
        await post(`/sessions/${id}/name/accept`, {});
        expect((await state()).sessions[0].name).toMatchObject({ text: "Its next", by: "you" });
        expect((await post(`/sessions/${id}/name`, { text: "" })).status).toBe(400);
    });

    test("a session nobody named gets one from what you asked it; one that named itself keeps its own", async () => {
        srv.close();
        const dir = mkdtempSync(join(tmpdir(), "wintos-name-"));
        writeFileSync(join(dir, "model"), `#!/bin/sh\ncat > "${dir}/prompt"\necho '"Retention backfill review fixes"'\n`, { mode: 0o755 });
        const transcript = join(dir, "t.jsonl");
        writeFileSync(transcript, JSON.stringify({ type: "user", message: { content: "Fix the review comments on the retention backfill" } }) + "\n");
        srv = await startServer({ root, port: 0, token: "t0ken", recapCmd: join(dir, "model") });
        base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
        await event(prompt);
        await event({ ...prompt, hook_event_name: "Stop", transcript_path: transcript });
        for (let i = 0; i < 50 && !(await state()).sessions[0].name; i++) await new Promise((r) => setTimeout(r, 50));
        expect((await state()).sessions[0].name).toMatchObject({ text: "Retention backfill review fixes", by: "model" });
        expect(readFileSync(join(dir, "prompt"), "utf8")).toContain("- Fix the review comments on the retention backfill");
        await event({ ...prompt, session_id: "own" });
        await post(`/blocks/blk-1/name?session=own`, { text: "Its own" });
        await event({ ...prompt, session_id: "own", hook_event_name: "Stop", transcript_path: transcript });
        await new Promise((r) => setTimeout(r, 300));
        expect((await state()).sessions.find((x: { id: string }) => x.id === "own").name).toMatchObject({ text: "Its own", by: "session" });
    });

    test("shelved, it keeps its name, and resumed it has it again", async () => {
        const script = `cd '/w' && claude --resume '${id}'`;
        await post("/projects/tab-1/title", { title: "Idea skill", manual: true });
        await event(prompt);
        await post(`/sessions/${id}/name`, { text: "My own" });
        await post("/projects/tab-1/shelf", { script, label: "x" });
        expect((await state()).shelf["tab-1"][0].named).toMatchObject({ text: "My own", by: "you" });
        srv.close();
        srv = await startServer({ root, port: 0, token: "t0ken" });
        base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
        await event({ ...prompt, hook_event_name: "SessionStart", source: "resume" });
        expect((await state()).sessions[0].name).toMatchObject({ text: "My own", by: "you" });
    });
});

describe("the PR fixer", () => {
    const CONFLICTED = "https://github.com/o/r/pull/5", RED = "https://github.com/o/r/pull/6";
    const prs = [
        { repo: "o/r", number: 5, url: CONFLICTED, title: "t", author: "me", isDraft: false, createdAt: "", conflict: true, requestedMe: false, requestedTeam: false, reviewedByMe: false, reviewers: [], additions: 1, deletions: 1, branch: "b5", base: "main", head: "h5" },
        { repo: "o/r", number: 9, url: "https://github.com/o/r/pull/9", title: "t", author: "me", isDraft: false, createdAt: "", conflict: true, requestedMe: false, requestedTeam: false, reviewedByMe: false, reviewers: [], additions: 1, deletions: 1, branch: "b9", base: "main", head: "h9" },
        { repo: "o/r", number: 6, url: RED, title: "t", author: "me", isDraft: false, createdAt: "", conflict: false, requestedMe: false, requestedTeam: false, reviewedByMe: false, reviewers: [], additions: 1, deletions: 1, branch: "b6", head: "h6", checks: "FAILURE" },
    ];
    const until = async <T>(f: () => Promise<T>) => {
        for (let i = 0; i < 100; i++) {
            const v = await f();
            if (v) return v;
            await new Promise((r) => setTimeout(r, 50));
        }
        throw new Error("timed out");
    };
    const fixerOf = async () => (await (await fetch(base + "/state")).json()).fixer;
    // A fake gh-prs plugin and a fake claude that records its arguments and says it is done.
    const start = async (conflictsOff = false) => {
        srv.close();
        const dir = mkdtempSync(join(tmpdir(), "wintos-fix-"));
        writeFileSync(join(dir, "gh"), `#!/bin/sh\necho '${JSON.stringify({ me: "me", prs })}'\n`, { mode: 0o755 });
        writeFileSync(join(dir, "claude"), `#!/bin/sh\nprintf '%s\\n' "$@" >> "${dir}/args"\necho '{"type":"result","result":"Resolved and pushed."}'\n`, { mode: 0o755 });
        if (conflictsOff) {
            mkdirSync(join(root, ".fixer"), { recursive: true });
            writeFileSync(join(root, ".fixer", "settings.json"), JSON.stringify({ conflicts: false }));
        }
        srv = await startServer({ root, port: 0, token: "t0ken", plugins: [{ name: "gh-prs", cmd: [join(dir, "gh")], everyMs: 0 }], fixCmd: join(dir, "claude"), fixCwd: dir });
        base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
        return dir;
    };

    test("a conflict on my PR is resolved by itself, once per head commit, one run at a time, logged", async () => {
        const dir = await start();
        const runs = await until(async () => {
            const rs = (await fixerOf()).runs;
            return rs.length === 2 && rs.every((r: { exit?: number }) => r.exit === 0) && rs;
        });
        const [second, first] = runs;
        expect(second.startedAt).toBeGreaterThanOrEqual(first.endedAt);
        const run = runs.find((r: { url: string }) => r.url === CONFLICTED);
        expect(run).toMatchObject({ kind: "conflict", url: CONFLICTED, head: "h5", route: "fresh", result: "Resolved and pushed." });
        expect(readFileSync(join(dir, "args"), "utf8")).toContain(`${CONFLICTED} has merge conflicts`);
        expect(readFileSync(run.log, "utf8")).toContain("Resolved and pushed.");
        expect(readFileSync(join(root, ".fixer", "runs.jsonl"), "utf8").trim().split("\n").length).toBe(6); // queued, started, ended, twice
        await post("/plugins/gh-prs/run", {});
        await new Promise((r) => setTimeout(r, 200));
        expect((await fixerOf()).runs).toHaveLength(2);
    });

    test("turned off, a conflict waits for you", async () => {
        await start(true);
        await post("/plugins/gh-prs/run", {});
        await new Promise((r) => setTimeout(r, 200));
        expect((await fixerOf())).toMatchObject({ conflicts: false, runs: [] });
        expect((await post("/fixer/settings", { conflicts: "yes" })).status).toBe(400);
        await post("/fixer/settings", { conflicts: true });
        await post("/plugins/gh-prs/run", {});
        await until(async () => (await fixerOf()).runs.length === 2);
    });

    test("red CI, dispatched: typed into the live owning session's pane; not red is refused", async () => {
        await start(true);
        await until(async () => (await (await fetch(base + "/state")).json()).plugins["gh-prs"]);
        await event(prompt);
        await event({ hook_event_name: "PostToolUse", session_id: prompt.session_id, prs: [RED] });
        const r = await (await post("/fixer/ci", { url: RED })).json();
        expect(r).toMatchObject({ blockId: "blk-1", tabId: "tab-1", run: { kind: "ci", route: "pane", sessionId: prompt.session_id } });
        expect(r.prompt).toContain(`CI is red on ${RED}`);
        expect((await post("/fixer/ci", { url: CONFLICTED })).status).toBe(409);
    });

    test("red CI with no owner: a fresh headless run", async () => {
        const dir = await start(true);
        await until(async () => (await (await fetch(base + "/state")).json()).plugins["gh-prs"]);
        expect((await (await post("/fixer/ci", { url: RED })).json()).run.route).toBe("fresh");
        await until(async () => (await fixerOf()).runs.some((r: { exit?: number }) => r.exit === 0));
        expect(readFileSync(join(dir, "args"), "utf8")).toContain("gh run rerun");
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
    const seenOf = async (id = "sess-1") => (await (await fetch(base + "/state")).json()).seen[id];

    test("the UI marks a session seen; it survives a restart", async () => {
        expect((await post("/sessions/sess-1/seen", {})).status).toBe(200);
        const at = await seenOf();
        expect(at).toBeGreaterThan(0);
        srv.close();
        srv = await startServer({ root, port: 0, token: "t0ken" });
        base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
        expect(await seenOf()).toBe(at);
    });

    test("prompting a session means you read what came before", async () => {
        await event(prompt);
        expect(await seenOf(prompt.session_id)).toBeGreaterThan(0);
    });
});

describe("the daily recap", () => {
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    test("a session's events note its project and transcript for the day", async () => {
        await event({ ...prompt, transcript_path: "/t/s.jsonl" });
        const activity = JSON.parse(readFileSync(join(root, ".activity.json"), "utf8"));
        expect(activity[iso(new Date())]["tab-1"]).toMatchObject({ prompts: 1, sessions: { [prompt.session_id]: "/t/s.jsonl" } });
    });

    test("the last worked day before today, one bullet per project it spent time on, from its recap", async () => {
        const day = "2026-10-06";
        // Busy from 12:00 to 12:20 (minutes 0 to 20, four apart); a 2-minute project is noise.
        const work = (minutes: number[]) => minutes.map((m) => JSON.stringify({ timestamp: `${day}T12:${String(m).padStart(2, "0")}:00Z`, type: "assistant" }));
        const transcript = join(root, "t.jsonl"), brief = join(root, "b.jsonl");
        writeFileSync(transcript, [...work([0, 4, 8, 12, 16, 20]), JSON.stringify({ timestamp: `${day}T15:00:00Z`, type: "system", subtype: "away_summary", content: "We merged the two lanes. Next, rerun it." })].join("\n"));
        writeFileSync(brief, [...work([30, 32]), JSON.stringify({ timestamp: `${day}T15:00:00Z`, type: "system", subtype: "away_summary", content: "Looked at one thing." })].join("\n"));
        writeFileSync(join(root, ".activity.json"), JSON.stringify({ [day]: { "tab-1": { title: "Idea skill", prompts: 3, sessions: { s: transcript } }, "tab-2": { title: "Quick look", prompts: 9, sessions: { b: brief } } } }));
        srv.close();
        srv = await startServer({ root, port: 0, token: "t0ken" });
        base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
        expect(await (await fetch(base + "/day/recap")).json()).toEqual({ date: day, items: [{ id: "0", project: "Idea skill", text: "Idea skill: We merged the two lanes.", details: [], dropped: false, top: false, edited: false }] });
    });

    describe("from a summarizer, curated", () => {
        const day = "2026-10-06";
        const restart = async (recapCmd?: string) => {
            srv.close();
            srv = await startServer({ root, port: 0, token: "t0ken", recapCmd });
            base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
        };
        beforeEach(async () => {
            const work = (minutes: number[]) => minutes.map((m) => JSON.stringify({ timestamp: `${day}T12:${String(m).padStart(2, "0")}:00Z`, type: "assistant" }));
            const long = join(root, "long.jsonl"), mine = join(root, "mine.jsonl");
            writeFileSync(long, [...work([0, 4, 8, 12, 16, 20, 24, 28]), JSON.stringify({ timestamp: `${day}T15:00:00Z`, type: "system", subtype: "away_summary", content: "Claude tested it." })].join("\n"));
            writeFileSync(mine, [...work([0, 4, 8, 12]), JSON.stringify({ timestamp: `${day}T15:00:00Z`, type: "system", subtype: "away_summary", content: "We built it." })].join("\n"));
            writeFileSync(join(root, ".activity.json"), JSON.stringify({ [day]: { "tab-1": { title: "Agent ran", prompts: 1, sessions: { a: long } }, "tab-2": { title: "Intake", prompts: 12, sessions: { b: mine } } } }));
            const model = join(root, "model.sh");
            writeFileSync(model, `cat > ${join(root, "recap-prompt.txt")}\nprintf -- '- [Intake] Ready for review: Document intake\\n  - Register-only intake (DEV-1)\\n- [Agent ran] Merged: Benefit-tax fix\\n'`, { mode: 0o755 });
            await restart(model);
        });

        test("its items, with project and details; the developer's own effort leads the prompt", async () => {
            const r = await (await fetch(base + "/day/recap")).json();
            expect(r.items.map((i: { project: string; text: string; details: string[] }) => [i.project, i.text, i.details])).toEqual([["Intake", "Ready for review: Document intake", ["Register-only intake"]], ["Agent ran", "Merged: Benefit-tax fix", []]]);
            const prompt = readFileSync(join(root, "recap-prompt.txt"), "utf8");
            expect(prompt.indexOf("## Intake (")).toBeLessThan(prompt.indexOf("## Agent ran ("));
        });

        test("a weekly reflection shows what you read out about each of its days, dropped items left out", async () => {
            const dir = join(root, "journal");
            mkdirSync(join(dir, "2026", "10"), { recursive: true });
            writeFileSync(join(dir, "2026", "10", "2026-10-06.md"), "# Tuesday\n\n## Today's focus (1-3 items)\n\n- [ ] a\n");
            writeFileSync(join(dir, "2026", "10", "2026-10-09.md"), "# Friday\n\n## Weekly reflection - Week 41/2026\n\n- **Goals Review**\n");
            const { Journal } = await import("../journal/journal");
            srv.close();
            srv = await startServer({ root, port: 0, token: "t0ken", recapCmd: join(root, "model.sh"), journal: new Journal(dir, join(root, "tpl.md"), join(root, ".day-planned.json")) });
            base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
            await fetch(base + "/day/recap");
            await post("/day/recap/1", { drop: true });
            const r = await (await fetch(base + "/reflection?date=2026-10-09")).json();
            expect(r.days.find((d: { date: string }) => d.date === "2026-10-06").readOut).toEqual(["Ready for review: Document intake"]);
        });

        test("drop, lift and rewrite an item; it stays so after a restart, and the rewrite teaches the next prompt", async () => {
            await fetch(base + "/day/recap");
            expect((await post("/day/recap/1", { top: true })).status).toBe(200);
            await post("/day/recap/0", { drop: true });
            const r = await (await post("/day/recap/0", { text: "Ready for review: DO holds every document\n- Register-only" })).json();
            expect(r.items.map((i: { id: string; dropped: boolean; top: boolean; text: string }) => [i.id, i.top, i.dropped, i.text])).toEqual([["1", true, false, "Merged: Benefit-tax fix"], ["0", false, true, "Ready for review: DO holds every document"]]);
            await restart(join(root, "model.sh"));
            expect((await (await fetch(base + "/day/recap")).json()).items.map((i: { id: string }) => i.id)).toEqual(["1", "0"]);
            writeFileSync(join(root, ".recaps.json"), "{}");
            await fetch(base + "/day/recap");
            expect(readFileSync(join(root, "recap-prompt.txt"), "utf8")).toContain("Theirs:\nReady for review: DO holds every document\n- Register-only");
        });

        test("a bad change is a 400, an item not on the day a 404", async () => {
            expect((await post("/day/recap/0", { drop: "yes" })).status).toBe(400);
            expect((await post("/day/recap/0", {})).status).toBe(400);
            expect((await post("/day/recap/9", { drop: true })).status).toBe(404);
        });
    });
});

describe("the shelf", () => {
    const script = (id: string) => `cd '/w' && claude --resume '${id}'`;
    const shelfOf = async () => (await (await fetch(base + "/state")).json()).shelf;

    test("a shelved session keeps its PRs whoever touches them later (they are also in that session), and takes them back when it runs", async () => {
        const A = "https://github.com/o/r/pull/1", B = "https://github.com/o/r/pull/2";
        await post("/projects/tab-1/title", { title: "Idea skill", manual: true });
        await event(prompt);
        await event({ hook_event_name: "PostToolUse", session_id: prompt.session_id, prs: [A, B] });
        await post("/projects/tab-1/shelf", { script: script(prompt.session_id), label: "x" });
        await post("/events", { tabId: "tab-1", blockId: "blk-2", payload: { hook_event_name: "PostToolUse", session_id: "other", prs: [A] } });
        const st = await (await fetch(base + "/state")).json();
        expect([(await shelfOf())["tab-1"][0].prs, st.sessions.find((x: { id: string }) => x.id === "other").touched]).toEqual([[A, B], [A]]);
        await event({ ...prompt, hook_event_name: "SessionStart" });
        const state = await (await fetch(base + "/state")).json();
        expect(state.sessions.find((x: { id: string }) => x.id === prompt.session_id).prs).toEqual([A, B]);
    });

    test("reading a PR (gh pr view) touches nothing; `wintos pr --own` takes it over and the old owner keeps it as also-in", async () => {
        const A = "https://github.com/o/r/pull/1";
        await event(prompt);
        await event({ hook_event_name: "PostToolUse", session_id: prompt.session_id, prs: [A], pr_verb: "view" });
        expect((await (await fetch(base + "/state")).json()).sessions[0].prs ?? []).toEqual([]);
        await event({ hook_event_name: "PostToolUse", session_id: prompt.session_id, prs: [A], pr_verb: "edit" });
        await post("/events", { tabId: "tab-1", blockId: "blk-2", payload: { ...prompt, session_id: "taker" } });
        expect((await post("/blocks/blk-2/pr?session=taker", { ref: "o/r#1", own: true })).status).toBe(200);
        const st = await (await fetch(base + "/state")).json();
        const by = (id: string) => st.sessions.find((x: { id: string }) => x.id === id);
        expect([by("taker").prs, by(prompt.session_id).prs, by(prompt.session_id).touched]).toEqual([[A], [], [A]]);
    });

    test("`wintos pr` claims a PR named by link or owner/repo#n for the pane's session", async () => {
        await event(prompt);
        expect((await post("/blocks/blk-1/pr", { ref: "o/r#7" })).status).toBe(200);
        expect((await post("/blocks/blk-1/pr", { ref: "#7" })).status).toBe(400);
        expect((await post("/blocks/nope/pr", { ref: "o/r#7" })).status).toBe(400);
        const state = await (await fetch(base + "/state")).json();
        expect(state.sessions[0].prs).toEqual(["https://github.com/o/r/pull/7"]);
    });

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

    test("its name is the status line the session last set, when it set one", async () => {
        await post("/projects/tab-1/title", { title: "Idea skill", manual: true });
        await event(prompt);
        await post("/blocks/blk-1/status", { text: "deploying the stack to test" });
        await post("/projects/tab-1/shelf", { script: script(prompt.session_id), label: "I'm back now, go ahead!" });
        expect((await shelfOf())["tab-1"][0]).toMatchObject({ name: "deploying the stack to test", label: "I'm back now, go ahead!" });
    });

    test("a 3-6 word title is written for it in the background, and shown first", async () => {
        srv.close();
        srv = await startServer({ root, port: 0, token: "t0ken", recapCmd: `cat > ${join(root, "title-prompt.txt")}; echo '"Merge the two lanes."'` });
        base = `http://127.0.0.1:${(srv.http.address() as { port: number }).port}`;
        await post("/projects/tab-1/title", { title: "Idea skill", manual: true });
        await event(prompt);
        await post("/projects/tab-1/shelf", { script: script(prompt.session_id), label: "I'm back now, go ahead!" });
        for (let i = 0; i < 50 && !(await shelfOf())["tab-1"]?.[0]?.title; i++) await new Promise((r) => setTimeout(r, 50));
        expect((await shelfOf())["tab-1"][0].title).toBe("Merge the two lanes");
        expect(readFileSync(join(root, "title-prompt.txt"), "utf8")).toContain("Its first prompt: I'm back now, go ahead!");
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

    test("the pane switched to another session (a fork, /resume): the one it ran goes on the shelf with its status and PRs", async () => {
        const A = "https://github.com/o/r/pull/1";
        await post("/projects/tab-1/title", { title: "Idea skill", manual: true });
        await event({ ...prompt, session_id: "fork", resume: script("fork") });
        await post(`/blocks/blk-1/status?session=fork`, { text: "explaining the drop" });
        await event({ hook_event_name: "PostToolUse", session_id: "fork", prs: [A] });
        await event({ ...prompt, hook_event_name: "Stop", session_id: "fork" });
        await event({ ...prompt, session_id: "main", resume: script("main") });
        const st = await (await fetch(base + "/state")).json();
        expect(st.sessions.map((x: { id: string }) => x.id)).toEqual(["main"]);
        expect(st.shelf["tab-1"]).toEqual([expect.objectContaining({ sessionId: "fork", script: script("fork"), name: "explaining the drop", prs: [A] })]);
    });

    test("a session saved at the last quit that another one replaces in its pane goes on the shelf, resumed from its directory", async () => {
        await post("/projects/tab-1/title", { title: "Idea skill", manual: true });
        await event({ ...prompt, session_id: "old", cwd: "/w/it's" });
        srv.close();
        srv = await startServer({ root, port: 0, token: "t0ken" });
        base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
        await event({ ...prompt, session_id: "new", resume: script("new") });
        expect((await shelfOf())["tab-1"]).toEqual([expect.objectContaining({ sessionId: "old", script: "cd '/w/it'\\''s' && claude --resume 'old'" })]);
    });

    test("a session never prompted has no conversation to resume, so closing its project shelves nothing", async () => {
        await post("/projects/tab-1/title", { title: "Idea skill", manual: true });
        await event({ hook_event_name: "SessionStart", source: "startup", session_id: "empty", cwd: "/w" });
        await post("/projects/tab-1/shelve-all", {});
        expect(await shelfOf()).toEqual({});
    });

    test("closing the project (⇧⌘W) shelves every session it runs first, and a second time changes nothing", async () => {
        await post("/projects/tab-1/title", { title: "Idea skill", manual: true });
        await event({ ...prompt, session_id: "a", resume: script("a") });
        await post("/events", { tabId: "tab-1", blockId: "blk-2", payload: { ...prompt, session_id: "b", resume: script("b") } });
        expect((await post("/projects/tab-1/shelve-all", {})).status).toBe(200);
        await post("/projects/tab-1/shelve-all", {});
        expect((await shelfOf())["tab-1"].map((i: { sessionId: string }) => i.sessionId).sort()).toEqual(["a", "b"]);
        expect((await post("/projects/tab-9/shelve-all", {})).status).toBe(404);
    });

    test("a restart keeps a session's PRs: quitting ends nothing, the resumed session finds them again", async () => {
        const A = "https://github.com/o/r/pull/1";
        await event({ ...prompt, resume: script(prompt.session_id) });
        await event({ hook_event_name: "PostToolUse", session_id: prompt.session_id, prs: [A] });
        await event({ ...prompt, hook_event_name: "SessionEnd", reason: "other" });
        srv.close();
        srv = await startServer({ root, port: 0, token: "t0ken" });
        base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
        await event({ ...prompt, hook_event_name: "SessionStart", source: "resume", resume: script(prompt.session_id) });
        expect((await (await fetch(base + "/state")).json()).sessions).toEqual([expect.objectContaining({ id: prompt.session_id, prs: [A] })]);
    });

    test("⌘W's shelving ends the session: its pane is going", async () => {
        await post("/projects/tab-1/title", { title: "Idea skill", manual: true });
        await event(prompt);
        await post("/projects/tab-1/shelf", { script: script(prompt.session_id), label: "x" });
        expect((await (await fetch(base + "/state")).json()).sessions[0].state).toBe("ended");
    });

    test("a background fork's events (no resume command) shelve nothing", async () => {
        await post("/projects/tab-1/title", { title: "Idea skill", manual: true });
        await event({ ...prompt, session_id: "main", resume: script("main") });
        await event({ ...prompt, session_id: "bg" });
        expect((await (await fetch(base + "/state")).json()).sessions.map((x: { id: string }) => x.id).sort()).toEqual(["bg", "main"]);
        expect(await shelfOf()).toEqual({});
    });

    test("only the hook's resume command, and only for a project", async () => {
        await post("/projects/tab-1/title", { title: "Idea skill", manual: true });
        expect((await post("/projects/tab-1/shelf", { script: "rm -rf ~", label: "x" })).status).toBe(400);
        expect((await post("/projects/tab-9/shelf", { script: script("s1"), label: "x" })).status).toBe(404);
    });
});

describe("repo short names", () => {
    test("saved to your file, shown in the state, a hand edit too; empty removes one; bad input is a 400", async () => {
        const file = join(root, "cfg", "repos.json");
        srv.close();
        srv = await startServer({ root, port: 0, token: "t0ken", repoNamesFile: file });
        base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
        const names = async () => (await (await fetch(base + "/state")).json()).repoNames;
        expect((await post("/repos/name", { repo: "o/Acme.Docs.Service", short: " DS " })).status).toBe(200);
        expect([await names(), JSON.parse(readFileSync(file, "utf8"))]).toEqual([{ "o/Acme.Docs.Service": "DS" }, { "o/Acme.Docs.Service": "DS" }]);
        writeFileSync(file, JSON.stringify({ "o/Acme.Docs.Service": "DS", "o/Core": "C" }));
        utimesSync(file, new Date(), new Date(Date.now() + 5000));
        expect(await names()).toEqual({ "o/Acme.Docs.Service": "DS", "o/Core": "C" });
        await post("/repos/name", { repo: "o/Core", short: "" });
        expect(await names()).toEqual({ "o/Acme.Docs.Service": "DS" });
        expect((await post("/repos/name", { repo: "nope", short: "x" })).status).toBe(400);
        expect((await post("/repos/name", { repo: "o/r", short: "x".repeat(17) })).status).toBe(400);
    });
});

describe("wakes", () => {
    const URL7 = "https://github.com/o/r/pull/7";
    let pr: { state: "OPEN" | "MERGED" | "CLOSED"; checks: "green" | "red" | "pending" | "none"; released: boolean } | undefined;
    const st = async () => (await fetch(base + "/state")).json();
    beforeEach(async () => {
        pr = { state: "OPEN", checks: "pending", released: false };
        srv.close();
        srv = await startServer({ root, port: 0, token: "t0ken", prNow: async () => pr, wakeEveryMs: 20 });
        base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
        await event(prompt);
    });
    const until = async (f: () => Promise<boolean>) => {
        for (let i = 0; i < 100 && !(await f()); i++) await new Promise((r) => setTimeout(r, 10));
    };

    test("set: the session parks on it; it turns due when the event comes, once delivered it is gone", async () => {
        expect((await post("/blocks/blk-1/wake", { until: "released", pr: "o/r#7", prompt: "check the re-embed in prod" })).status).toBe(200);
        const s = await st();
        // Mid-turn, as a session runs it: the turn ends parked.
        expect([s.wakes[prompt.session_id].pr, s.sessions[0].parkPending, s.sessions[0].parkedOn]).toEqual([URL7, true, "o/r#7 to be released"]);
        pr = { state: "MERGED", checks: "green", released: true };
        await until(async () => !!(await st()).wakes[prompt.session_id]?.due);
        expect((await st()).wakes[prompt.session_id].due).toBeGreaterThan(0);
        expect((await post(`/wakes/${prompt.session_id}/delivered`, {})).status).toBe(200);
        expect((await post(`/wakes/${prompt.session_id}/delivered`, {})).status).toBe(409);
        expect((await st()).wakes).toEqual({});
    });

    test("not due before its event, and dropped when it can't happen any more", async () => {
        await post("/blocks/blk-1/wake", { until: "merged", pr: URL7, prompt: "update the docs" });
        expect((await post(`/wakes/${prompt.session_id}/delivered`, {})).status).toBe(409);
        pr = { state: "CLOSED", checks: "none", released: false };
        await until(async () => !(await st()).wakes[prompt.session_id]);
        expect((await st()).wakes).toEqual({});
    });

    test("cancel; and every mistake says how to get it right", async () => {
        await post("/blocks/blk-1/wake", { until: "green", pr: URL7, prompt: "approve" });
        expect(await (await post("/blocks/blk-1/wake/cancel", {})).text()).toBe("cancelled");
        expect((await st()).wakes).toEqual({});
        const err = async (b: object) => (await post("/blocks/blk-1/wake", b)).text();
        expect(await err({ until: "deployed", pr: URL7, prompt: "x" })).toContain("use one of green, merged, released");
        expect(await err({ until: "green", pr: "#7", prompt: "x" })).toContain("owner/repo#123");
        expect(await err({ until: "green", pr: URL7, prompt: " " })).toContain("need the prompt");
        expect(await (await post("/blocks/nope/wake", { until: "green", pr: URL7, prompt: "x" })).text()).toContain("no live Claude session");
    });
});

test("a pane attached to a session moves it there, and the service's later events keep it there", async () => {
    await event({ ...prompt, hook_event_name: "UserPromptSubmit" });
    expect((await post(`/sessions/${prompt.session_id}/attach`, { tabId: "tab-2", blockId: "viewer" })).status).toBe(200);
    await event({ ...prompt, hook_event_name: "Stop" });
    const s = (await (await fetch(base + "/state")).json()).sessions.find((x: { id: string }) => x.id === prompt.session_id);
    expect([s.blockId, s.tabId, s.state]).toEqual(["viewer", "tab-2", "waiting"]);
    expect((await post(`/sessions/${prompt.session_id}/attach`, { tabId: 1 })).status).toBe(400);
});

describe("heads-ups", () => {
    const until = async (ok: () => Promise<boolean>) => {
        for (let i = 0; i < 100 && !(await ok()); i++) await new Promise((r) => setTimeout(r, 20));
    };
    const offer = (sessionId: string, line: string) => ({ seen: [line], sessions: [{ id: sessionId, view: { kind: "offer", line, explanation: "why", shownAt: 7 } }] });
    test("the plugin's offer shows on its session's project, stays after the plugin clears it, and closes with dismiss", async () => {
        const claude = mkdtempSync(join(tmpdir(), "wintos-claude-"));
        const dir = join(claude, "plugins", "store");
        mkdirSync(dir, { recursive: true });
        const file = join(dir, "cc-plugin-you-should-know_builtin-abc.json");
        writeFileSync(file, JSON.stringify({ seen: [], sessions: [] }));
        srv.close();
        srv = await startServer({ root, port: 0, token: "t0ken", claudeDirs: [claude] });
        base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
        await post("/projects/tab-1/title", { title: "X", manual: false });
        await event({ ...prompt, session_id: "s-1" });
        const projectId = (await (await fetch(base + "/state")).json()).projects[0].id;
        const shown = async () => (await (await fetch(base + "/state")).json()).headsUps?.[projectId];
        writeFileSync(file, JSON.stringify(offer("s-1", "Merging won't deploy it.")));
        await until(async () => !!(await shown()));
        expect(await shown()).toEqual([{ id: "s-1:7", sessionId: "s-1", project: "x", text: "Merging won't deploy it.", explanation: "why", at: 7 }]);
        writeFileSync(file, JSON.stringify({ seen: ["Merging won't deploy it."], sessions: [{ id: "s-1" }] }));
        await new Promise((r) => setTimeout(r, 150));
        expect(await shown()).toHaveLength(1);
        expect((await post("/headsups/s-1%3A7/dismiss", {})).status).toBe(200);
        expect(await shown()).toBeUndefined();
        expect((await post("/headsups/s-1%3A7/dismiss", {})).status).toBe(404);
        rmSync(claude, { recursive: true });
    });

    test("a session from another Claude config dir brings that dir's store in", async () => {
        const claude = mkdtempSync(join(tmpdir(), "wintos-claude-"));
        mkdirSync(join(claude, "plugins", "store"), { recursive: true });
        writeFileSync(join(claude, "plugins", "store", "cc-plugin-you-should-know_builtin-abc.json"), JSON.stringify(offer("s-1", "Heads up from the other account.")));
        srv.close();
        srv = await startServer({ root, port: 0, token: "t0ken", claudeDirs: [] });
        base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
        await post("/projects/tab-1/title", { title: "X", manual: false });
        await event({ ...prompt, session_id: "s-1" });
        expect((await (await fetch(base + "/state")).json()).headsUps).toEqual({});
        await event({ ...stop, session_id: "s-1", config_dir: claude });
        expect(Object.values((await (await fetch(base + "/state")).json()).headsUps).flat()).toMatchObject([{ text: "Heads up from the other account." }]);
        rmSync(claude, { recursive: true });
    });

    test("a store whose shape changed is reported in /state", async () => {
        const claude = mkdtempSync(join(tmpdir(), "wintos-claude-"));
        mkdirSync(join(claude, "plugins", "store"), { recursive: true });
        writeFileSync(join(claude, "plugins", "store", "cc-plugin-you-should-know_builtin-abc.json"), JSON.stringify({ seen: [], entries: [] }));
        srv.close();
        srv = await startServer({ root, port: 0, token: "t0ken", claudeDirs: [claude] });
        base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
        expect((await (await fetch(base + "/state")).json()).headsUpProblem).toBe("the store's shape changed: no sessions list");
        rmSync(claude, { recursive: true });
    });
});
