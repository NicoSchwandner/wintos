import { execFileSync, spawnSync } from "child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import http from "http";
import type { AddressInfo } from "net";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, test } from "vitest";

const CLI = join(__dirname, "wintos");
const HOOK = join(__dirname, "../hooks/wintos-hook.sh");
const tmp = () => mkdtempSync(join(tmpdir(), "wintos-cli-"));

let server: http.Server | undefined;
afterEach(() => server?.close());

function fakeDaemon(reply: string): Promise<{ port: number; seen: { url: string; body: any }[] }> {
    const seen: { url: string; body: any }[] = [];
    server = http.createServer((req, res) => {
        let b = "";
        req.on("data", (c) => (b += c));
        req.on("end", () => {
            seen.push({ url: req.url!, body: JSON.parse(b) });
            res.end(reply);
        });
    });
    return new Promise((r) => server!.listen(0, "127.0.0.1", () => r({ port: (server!.address() as AddressInfo).port, seen })));
}

const runHook = (env: Record<string, string>, input = '{"hook_event_name":"Stop","session_id":"s"}') =>
    spawnSync(HOOK, { input, env: { PATH: process.env.PATH!, ...env }, encoding: "utf8" });

// Async variant: a synchronous child would block the in-process fake daemon from answering.
const runHookAsync = (env: Record<string, string>, input = '{"hook_event_name":"Stop","session_id":"s"}') =>
    new Promise<string>((resolve) => {
        const c = require("child_process").execFile(HOOK, { env: { PATH: process.env.PATH!, ...env } }, (_e: unknown, so: string) => resolve(so));
        c.stdin.end(input);
    });

describe("wintos-hook.sh", () => {
    test("outside WintOS it does nothing", () => {
        const r = runHook({});
        expect([r.status, r.stdout]).toEqual([0, ""]);
    });

    test("forwards the payload with tab and block, prints the answer", async () => {
        const d = await fakeDaemon("context for claude");
        const out = await runHookAsync({ WAVETERM_TABID: "tab-1", WAVETERM_BLOCKID: "blk-1", WINTOS_PORT: String(d.port) });
        expect(out).toBe("context for claude");
        expect(d.seen[0]).toEqual({ url: "/events", body: { tabId: "tab-1", blockId: "blk-1", payload: { hook_event_name: "Stop", session_id: "s" } } });
    });

    test("a daemon error body never reaches Claude's context", async () => {
        const d = await fakeDaemon("need tabId, blockId");
        server!.removeAllListeners("request");
        server!.on("request", (_q, res) => { res.statusCode = 400; res.end("need tabId, blockId"); });
        const out = await runHookAsync({ WAVETERM_TABID: "t", WAVETERM_BLOCKID: "b", WINTOS_PORT: String(d.port) });
        expect(out).toBe("");
    });

    test("with the daemon down it exits 0 within a second", () => {
        const t = Date.now();
        const r = runHook({ WAVETERM_TABID: "t", WINTOS_PORT: "1" });
        expect(r.status).toBe(0);
        expect(Date.now() - t).toBeLessThan(1000);
    });
});

describe("wintos hooks", () => {
    const setup = () => {
        const dir = tmp();
        const settings = join(dir, "settings.json");
        writeFileSync(settings, JSON.stringify({ model: "x", hooks: { Stop: [{ hooks: [{ type: "command", command: "mine.sh" }] }] } }));
        const run = (verb: string) => execFileSync(CLI, ["hooks", verb], { env: { ...process.env, WINTOS_CLAUDE_SETTINGS: settings } });
        return { settings, run, read: () => JSON.parse(readFileSync(settings, "utf8")) };
    };

    test("install is idempotent and keeps the user's hooks", () => {
        const { run, read } = setup();
        run("install");
        run("install");
        const s = read();
        expect(s.model).toBe("x");
        expect(s.hooks.Stop).toHaveLength(2);
        expect(s.hooks.Stop[0].hooks[0].command).toBe("mine.sh");
        for (const e of ["SessionStart", "UserPromptSubmit", "Stop", "SubagentStop", "Notification", "SessionEnd"])
            expect(s.hooks[e].filter((h: any) => h.hooks[0].command.endsWith("wintos-hook.sh"))).toHaveLength(1);
    });

    test("hooks without a command (prompt/agent types) survive install and uninstall", () => {
        const { settings, run, read } = setup();
        writeFileSync(settings, JSON.stringify({ model: "x", hooks: { Stop: [{ hooks: [{ type: "prompt", prompt: "check" }] }] } }));
        run("install");
        expect(read().hooks.Stop[0]).toEqual({ hooks: [{ type: "prompt", prompt: "check" }] });
        run("uninstall");
        expect(read()).toEqual({ model: "x", hooks: { Stop: [{ hooks: [{ type: "prompt", prompt: "check" }] }] } });
    });

    test("when jq cannot process the file, settings.json is left exactly as it was", () => {
        const { settings, run } = setup();
        writeFileSync(settings, "{ not json");
        expect(() => run("install")).toThrow();
        expect(readFileSync(settings, "utf8")).toBe("{ not json");
    });

    test("the first backup is never overwritten by later runs", () => {
        const { settings, run } = setup();
        const original = readFileSync(settings, "utf8");
        run("install");
        run("install");
        expect(readFileSync(settings + ".wintos-bak", "utf8")).toBe(original);
    });

    test("uninstall removes only ours", () => {
        const { run, read } = setup();
        run("install");
        run("uninstall");
        expect(read().hooks).toEqual({ Stop: [{ hooks: [{ type: "command", command: "mine.sh" }] }] });
    });
});

describe("wintos title", () => {
    test("posts a non-manual title for this tab", async () => {
        const d = await fakeDaemon(JSON.stringify({ title: "Invoice OCR", titleLocked: false }));
        const out = await new Promise<string>((resolve) =>
            require("child_process").execFile(CLI, ["title", "Invoice", "OCR"], { env: { ...process.env, WAVETERM_TABID: "tab-1", WINTOS_PORT: String(d.port) } }, (_e: unknown, so: string) => resolve(so))
        );
        expect(out.trim()).toBe("titled: Invoice OCR");
        expect(d.seen[0]).toEqual({ url: "/projects/tab-1/title", body: { title: "Invoice OCR", manual: false } });
    });

    test("with the daemon down it fails loudly instead of claiming success", () => {
        const r = spawnSync(CLI, ["title", "x"], { env: { PATH: process.env.PATH!, WAVETERM_TABID: "t", WINTOS_PORT: "1" }, encoding: "utf8" });
        expect(r.status).toBe(1);
        expect(r.stderr).toContain("not reachable");
    });

    test("outside WintOS it explains instead of guessing", () => {
        const r = spawnSync(CLI, ["title", "x"], { env: { PATH: process.env.PATH! }, encoding: "utf8" });
        expect(r.status).toBe(1);
        expect(r.stderr).toContain("no WAVETERM_TABID");
    });
});
