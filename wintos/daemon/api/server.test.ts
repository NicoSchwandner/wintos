import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
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
    srv = await startServer({ root, port: 0 });
    base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
});
afterEach(() => srv.close());

const JSON_HEADERS = { "Content-Type": "application/json" };
const post = (path: string, body: unknown, headers: Record<string, string> = JSON_HEADERS) =>
    fetch(base + path, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
const event = (payload: object, tabId = "tab-1") => post("/events", { tabId, blockId: "blk-1", payload });

describe("wintosd API", () => {
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
        const ws = new WebSocket(base.replace("http", "ws") + "/ws", { origin: "http://localhost:5173" });
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
        const ok = await fetch(base + "/state", { headers: { Origin: "http://localhost:5173" } });
        expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    });
});

describe("notes", () => {
    test("GET notes returns project.md's body and mine.md", async () => {
        await post("/projects/tab-1/title", { title: "X", manual: false });
        writeFileSync(join(root, "x", "mine.md"), "## Ceiling\ntwo vendors\n");
        const n = await (await fetch(base + "/projects/tab-1/notes")).json();
        expect(n).toEqual({ dir: join(root, "x"), projectMd: "", mine: "## Ceiling\ntwo vendors\n" });
    });

    test("saving mine.md writes the file in the project folder", async () => {
        await post("/projects/tab-1/title", { title: "X", manual: false });
        expect((await post("/projects/tab-1/mine", { text: "## Promised\nmetric\n" })).status).toBe(200);
        expect(require("fs").readFileSync(join(root, "x", "mine.md"), "utf8")).toBe("## Promised\nmetric\n");
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
