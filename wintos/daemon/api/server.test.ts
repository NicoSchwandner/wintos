import { mkdtempSync, writeFileSync } from "fs";
import type { AddressInfo } from "net";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
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

const post = (path: string, body: unknown) =>
    fetch(base + path, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
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

    test("the stream pushes state after an event", async () => {
        const res = await fetch(base + "/stream");
        const reader = res.body!.getReader();
        await reader.read(); // initial state
        await event(stop);
        const { value } = await reader.read();
        expect(new TextDecoder().decode(value)).toMatch(/^event: state\ndata: .*"waiting"/);
        await reader.cancel();
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

    test("responses allow the renderer's origin", async () => {
        expect((await fetch(base + "/state")).headers.get("access-control-allow-origin")).toBe("*");
    });
});
