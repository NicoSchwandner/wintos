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

describe("wintos-hook.sh keeps the block's resume command", () => {
    // A fake wsh that records its arguments, one call per line.
    const fakeWsh = () => {
        const dir = tmp();
        writeFileSync(join(dir, "wsh"), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${dir}/calls"\n`, { mode: 0o755 });
        return { dir, calls: () => (require("fs").existsSync(join(dir, "calls")) ? readFileSync(join(dir, "calls"), "utf8") : "") };
    };
    // What Claude Code gives the hooks of an interactive session: it marks everything it
    // spawns as a child session, its own hooks included.
    const CLAUDE_HOOK_ENV = { CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CODE_CHILD_SESSION: "1" };
    const env = (dir: string, extra: Record<string, string> = {}) => ({ ...CLAUDE_HOOK_ENV, WAVETERM_TABID: "t", WAVETERM_BLOCKID: "blk", WAVETERM_WSHBINDIR: dir, WINTOS_PORT: "1", ...extra });

    test("a prompt sets cmd:initscript to resume this session in its directory", () => {
        const w = fakeWsh();
        runHook(env(w.dir), JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "s-1", cwd: "/tmp/it's here", prompt: "hi" }));
        expect(w.calls()).toBe(`setmeta -b blk cmd:initscript=cd '/tmp/it'\\''s here' && claude --resume 's-1'\n`);
    });

    test("a session of another Claude account resumes in that account", () => {
        const w = fakeWsh();
        runHook(env(w.dir, { CLAUDE_CONFIG_DIR: "/Users/n/.claude-private" }), JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "s-1", cwd: "/Users/n/personal" }));
        expect(w.calls()).toBe(`setmeta -b blk cmd:initscript=cd '/Users/n/personal' && CLAUDE_CONFIG_DIR='/Users/n/.claude-private' claude --resume 's-1'\n`);
    });

    test("without one set, the resume sets none: setting it, even to the default, changes the account's keychain item", () => {
        const w = fakeWsh();
        runHook(env(w.dir, { CLAUDE_CONFIG_DIR: "" }), JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "s-1", cwd: "/Users/n/work" }));
        expect(w.calls()).not.toContain("CLAUDE_CONFIG_DIR");
    });

    test("quitting WintOS (SessionEnd reason other) keeps the resume command", () => {
        const w = fakeWsh();
        runHook(env(w.dir), JSON.stringify({ hook_event_name: "SessionEnd", session_id: "s-1", reason: "other" }));
        expect(w.calls()).toBe("");
    });

    test.each(["prompt_input_exit", "logout"])("a deliberate exit (%s) clears it", (reason) => {
        const w = fakeWsh();
        runHook(env(w.dir), JSON.stringify({ hook_event_name: "SessionEnd", session_id: "s-1", reason }));
        expect(w.calls()).toBe("setmeta -b blk cmd:initscript=\n");
    });

    test("the resume starts in the launch directory, not wherever the session moved to", () => {
        const w = fakeWsh();
        runHook(env(w.dir, { CLAUDE_PROJECT_DIR: "/Users/n/work" }), JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "s-1", cwd: "/Users/n/work/Core/src" }));
        expect(w.calls()).toBe(`setmeta -b blk cmd:initscript=cd '/Users/n/work' && claude --resume 's-1'\n`);
    });

    test("a headless `claude -p` run from inside the session never takes over the block's resume command", () => {
        const w = fakeWsh();
        runHook(env(w.dir, { CLAUDE_CODE_ENTRYPOINT: "sdk-cli" }), JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "throwaway", cwd: "/x" }));
        expect(w.calls()).toBe("");
    });

    test("a new session's start does not, since Claude saves nothing to resume before the first prompt", () => {
        const w = fakeWsh();
        runHook(env(w.dir), JSON.stringify({ hook_event_name: "SessionStart", source: "startup", session_id: "s-1", cwd: "/x" }));
        expect(w.calls()).toBe("");
    });

    test("a resumed session's start does: it is saved already, and closed before a prompt it still shelves", () => {
        const w = fakeWsh();
        runHook(env(w.dir), JSON.stringify({ hook_event_name: "SessionStart", source: "resume", session_id: "s-1", cwd: "/x" }));
        expect(w.calls()).toBe(`setmeta -b blk cmd:initscript=cd '/x' && claude --resume 's-1'\n`);
    });

    test("other events leave the block alone", () => {
        const w = fakeWsh();
        runHook(env(w.dir), JSON.stringify({ hook_event_name: "Stop", session_id: "s-1" }));
        expect(w.calls()).toBe("");
    });

    test("without a block id nothing is written", () => {
        const w = fakeWsh();
        runHook({ WAVETERM_TABID: "t", WAVETERM_WSHBINDIR: w.dir, WINTOS_PORT: "1" }, JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "s", cwd: "/x" }));
        expect(w.calls()).toBe("");
    });
});

describe("wintos-hook.sh on PostToolUse", () => {
    const post = (command: string, stdout: string) => JSON.stringify({ hook_event_name: "PostToolUse", session_id: "s", cwd: "/x", tool_name: "Bash", tool_input: { command }, tool_response: { stdout } });
    test("sends only the PR links of a gh pr command, not the output", async () => {
        const d = await fakeDaemon("");
        await runHookAsync({ WAVETERM_TABID: "t", WAVETERM_BLOCKID: "b", WINTOS_PORT: String(d.port) }, post("gh pr create --fill", "https://github.com/o/r/pull/12\n"));
        expect(d.seen[0].body.payload).toEqual({ hook_event_name: "PostToolUse", session_id: "s", cwd: "/x", prs: ["https://github.com/o/r/pull/12"] });
    });
    test("a PR named by number and repo counts too", async () => {
        const d = await fakeDaemon("");
        await runHookAsync({ WAVETERM_TABID: "t", WAVETERM_BLOCKID: "b", WINTOS_PORT: String(d.port) }, post("gh pr edit 340 -R WintDev/Wint.HeartMcp --add-reviewer x", ""));
        expect(d.seen[0].body.payload.prs).toEqual(["https://github.com/WintDev/Wint.HeartMcp/pull/340"]);
    });
    test("a command that is no gh pr command sends nothing", async () => {
        const d = await fakeDaemon("");
        await runHookAsync({ WAVETERM_TABID: "t", WAVETERM_BLOCKID: "b", WINTOS_PORT: String(d.port) }, post("ls", "https://github.com/o/r/pull/12"));
        expect(d.seen).toEqual([]);
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
        for (const e of ["SessionStart", "UserPromptSubmit", "Stop", "SubagentStop", "Notification", "SessionEnd", "PostToolUse"])
            expect(s.hooks[e].filter((h: any) => h.hooks[0].command.endsWith("wintos-hook.sh"))).toHaveLength(1);
        expect(s.hooks.PostToolUse[0].matcher).toBe("Bash");
    });

    test("a Claude config dir given names where they go; another account's settings stay as they were", () => {
        const { settings, read } = setup();
        const other = tmp();
        execFileSync(CLI, ["hooks", "install", other], { env: { ...process.env, WINTOS_CLAUDE_SETTINGS: settings } });
        const s = JSON.parse(readFileSync(join(other, "settings.json"), "utf8"));
        expect(s.hooks.Stop[0].hooks[0].command).toMatch(/wintos-hook\.sh$/);
        expect(read().hooks.Stop).toHaveLength(1);
        execFileSync(CLI, ["hooks", "uninstall", other]);
        expect(JSON.parse(readFileSync(join(other, "settings.json"), "utf8"))).toEqual({});
    });

    test("a config dir that does not exist is refused", () => {
        expect(() => execFileSync(CLI, ["hooks", "install", join(tmp(), "nope")], { stdio: "pipe" })).toThrow(/no such Claude config dir/);
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

describe("wintos wait", () => {
    test("parks this block's session on what it waits for", async () => {
        const d = await fakeDaemon("");
        const out = await new Promise<string>((resolve) =>
            require("child_process").execFile(CLI, ["wait", "CI", "on", "#1479"], { env: { ...process.env, WAVETERM_BLOCKID: "blk-1", WINTOS_PORT: String(d.port) } }, (_e: unknown, so: string) => resolve(so))
        );
        expect(out.trim()).toBe("waiting on: CI on #1479");
        expect(d.seen[0]).toEqual({ url: "/blocks/blk-1/wait", body: { reason: "CI on #1479" } });
    });

    test("outside WintOS it explains instead of guessing", () => {
        const r = spawnSync(CLI, ["wait", "x"], { env: { PATH: process.env.PATH! }, encoding: "utf8" });
        expect(r.status).toBe(1);
        expect(r.stderr).toContain("no WAVETERM_BLOCKID");
    });
});

describe("wintos status", () => {
    test("sets this block's session's line", async () => {
        const d = await fakeDaemon("");
        const out = await new Promise<string>((resolve) =>
            require("child_process").execFile(CLI, ["status", "Walking", "the", "plan"], { env: { ...process.env, WAVETERM_BLOCKID: "blk-1", WINTOS_PORT: String(d.port) } }, (_e: unknown, so: string) => resolve(so))
        );
        expect(out.trim()).toBe("status: Walking the plan");
        expect(d.seen[0]).toEqual({ url: "/blocks/blk-1/status", body: { text: "Walking the plan" } });
    });
});

describe("wintos done", () => {
    test("ends this block's session turn as done", async () => {
        const d = await fakeDaemon("");
        const out = await new Promise<string>((resolve) =>
            require("child_process").execFile(CLI, ["done"], { env: { ...process.env, WAVETERM_BLOCKID: "blk-1", WINTOS_PORT: String(d.port) } }, (_e: unknown, so: string) => resolve(so))
        );
        expect(out.trim()).toBe("done: nothing waits on the developer");
        expect(d.seen[0]).toEqual({ url: "/blocks/blk-1/done", body: {} });
    });
});
