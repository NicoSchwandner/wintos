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
        const c = require("child_process").execFile(HOOK, { env: { PATH: process.env.PATH!, HOME: "/home/dev", ...env } }, (_e: unknown, so: string) => resolve(so));
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
        expect(d.seen[0]).toEqual({ url: "/events", body: { tabId: "tab-1", blockId: "blk-1", payload: { hook_event_name: "Stop", session_id: "s", config_dir: "/home/dev/.claude" } } });
    });

    test("the session's Claude config dir goes along: its plugin store holds the account's heads-ups", async () => {
        const d = await fakeDaemon("");
        await runHookAsync({ WAVETERM_TABID: "tab-1", WAVETERM_BLOCKID: "blk-1", WINTOS_PORT: String(d.port), CLAUDE_CONFIG_DIR: "/home/dev/.claude-private" });
        expect(d.seen[0].body.payload.config_dir).toBe("/home/dev/.claude-private");
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

describe("wintos-hook.sh and a question mid-turn", () => {
    test.each(["PreToolUse", "PostToolUse"])("%s of AskUserQuestion goes to the daemon without the question itself", async (name) => {
        const d = await fakeDaemon("");
        await runHookAsync({ WAVETERM_TABID: "t", WAVETERM_BLOCKID: "b", WINTOS_PORT: String(d.port) }, JSON.stringify({ hook_event_name: name, session_id: "s", cwd: "/x", tool_name: "AskUserQuestion", tool_input: { questions: [{ question: "secret?" }] } }));
        expect(d.seen[0].body.payload).toEqual({ hook_event_name: name, session_id: "s", cwd: "/x", tool_name: "AskUserQuestion", config_dir: "/home/dev/.claude" });
    });
});

describe("wintos-hook.sh tells the daemon which session the pane runs", () => {
    const env = (port: number, extra: Record<string, string> = {}) => ({ CLAUDE_CODE_ENTRYPOINT: "cli", WAVETERM_TABID: "t", WAVETERM_BLOCKID: "blk", WAVETERM_WSHBINDIR: tmp(), WINTOS_PORT: String(port), ...extra });

    test("its prompt carries the resume command", async () => {
        const d = await fakeDaemon("");
        await runHookAsync(env(d.port), JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "s-1", cwd: "/x" }));
        expect(d.seen[0].body.payload.resume).toBe("cd '/x' && claude --resume 's-1'");
    });

    test("a headless `claude -p` run from inside a session sends nothing: it is part of that session's work", async () => {
        const d = await fakeDaemon("");
        await runHookAsync(env(d.port, { CLAUDE_CODE_ENTRYPOINT: "sdk-cli" }), JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "throwaway", cwd: "/x" }));
        expect(d.seen).toEqual([]);
    });

    test("a background session's events say so; a spare one (no transcript yet) sends nothing", async () => {
        const t = join(tmp(), "fork.jsonl");
        writeFileSync(t, JSON.stringify({ type: "user" }));
        const d = await fakeDaemon("");
        await runHookAsync(env(d.port, { CLAUDE_CODE_SESSION_KIND: "bg" }), JSON.stringify({ hook_event_name: "Stop", session_id: "fork", cwd: "/x", transcript_path: t }));
        await runHookAsync(env(d.port, { CLAUDE_CODE_SESSION_KIND: "bg" }), JSON.stringify({ hook_event_name: "SessionStart", session_id: "spare", cwd: "/x", transcript_path: join(tmp(), "none.jsonl") }));
        expect(d.seen.map((x) => [x.body.payload.session_id, x.body.payload.kind])).toEqual([["fork", "bg"]]);
    });

    test("a background fork's carries none", async () => {
        const t = join(tmp(), "fork.jsonl");
        writeFileSync(t, JSON.stringify({ type: "user" }));
        const d = await fakeDaemon("");
        await runHookAsync(env(d.port, { CLAUDE_CODE_SESSION_KIND: "bg" }), JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "fork", cwd: "/x", transcript_path: t }));
        expect(d.seen[0].body.payload).not.toHaveProperty("resume");
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

    test("nor does a fork Claude Code runs in the background: it shares the pane, the pane is its parent's", () => {
        const w = fakeWsh();
        runHook(env(w.dir, { CLAUDE_CODE_SESSION_KIND: "bg" }), JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "fork", cwd: "/x" }));
        expect(w.calls()).toBe("");
    });

    test("a fork resumed in a pane runs in the pane's own Claude: it takes the pane, whatever its transcript says", () => {
        const w = fakeWsh();
        const t = join(tmp(), "fork.jsonl");
        writeFileSync(t, JSON.stringify({ type: "attachment", sessionKind: "bg" }));
        runHook(env(w.dir), JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "fork", cwd: "/x", transcript_path: t }));
        expect(w.calls()).toBe(`setmeta -b blk cmd:initscript=cd '/x' && claude --resume 'fork'\n`);
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
        expect(d.seen[0].body.payload).toEqual({ hook_event_name: "PostToolUse", session_id: "s", cwd: "/x", prs: ["https://github.com/o/r/pull/12"], pr_verb: "create", config_dir: "/home/dev/.claude" });
    });
    test("gh pr ready is sent even when it names no PR link, so the lane can move", async () => {
        const d = await fakeDaemon("");
        await runHookAsync({ WAVETERM_TABID: "t", WAVETERM_BLOCKID: "b", WINTOS_PORT: String(d.port) }, post("gh pr ready 12", "✓ Pull request o/r#12 is marked as \"ready for review\"\n"));
        expect(d.seen[0].body.payload).toEqual({ hook_event_name: "PostToolUse", session_id: "s", cwd: "/x", prs: [], pr_verb: "ready", config_dir: "/home/dev/.claude" });
    });
    test("a PR named by number and repo counts too", async () => {
        const d = await fakeDaemon("");
        await runHookAsync({ WAVETERM_TABID: "t", WAVETERM_BLOCKID: "b", WINTOS_PORT: String(d.port) }, post("gh pr edit 340 -R acme/mcp --add-reviewer x", ""));
        expect(d.seen[0].body.payload.prs).toEqual(["https://github.com/acme/mcp/pull/340"]);
        expect(d.seen[0].body.payload.pr_verb).toBe("edit");
    });
    test("gh pr view is sent with its verb, so the daemon can leave it out", async () => {
        const d = await fakeDaemon("");
        await runHookAsync({ WAVETERM_TABID: "t", WAVETERM_BLOCKID: "b", WINTOS_PORT: String(d.port) }, post("gh pr view 56 -R acme/proposals", ""));
        expect(d.seen[0].body.payload).toMatchObject({ pr_verb: "view", prs: ["https://github.com/acme/proposals/pull/56"] });
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
        for (const e of ["SessionStart", "UserPromptSubmit", "Stop", "SubagentStop", "Notification", "SessionEnd", "PreToolUse", "PostToolUse"])
            expect(s.hooks[e].filter((h: any) => h.hooks[0].command.endsWith("wintos-hook.sh"))).toHaveLength(1);
        // A question to the developer mid-turn: before it, the turn waits on them; after it, it runs on.
        expect([s.hooks.PreToolUse[0].matcher, s.hooks.PostToolUse[0].matcher]).toEqual(["AskUserQuestion|ExitPlanMode", "Bash|AskUserQuestion|ExitPlanMode"]);
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
            require("child_process").execFile(CLI, ["wait", "CI", "on", "#1479"], { env: { ...process.env, CLAUDE_CODE_SESSION_ID: "s-1", WAVETERM_BLOCKID: "blk-1", WINTOS_PORT: String(d.port) } }, (_e: unknown, so: string) => resolve(so))
        );
        expect(out.trim()).toBe("waiting on: CI on #1479");
        expect(d.seen[0]).toEqual({ url: "/blocks/blk-1/wait?session=s-1", body: { reason: "CI on #1479" } });
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
            require("child_process").execFile(CLI, ["status", "Walking", "the", "plan"], { env: { ...process.env, CLAUDE_CODE_SESSION_ID: "s-1", WAVETERM_BLOCKID: "blk-1", WINTOS_PORT: String(d.port) } }, (_e: unknown, so: string) => resolve(so))
        );
        expect(out.trim()).toBe("status: Walking the plan");
        expect(d.seen[0]).toEqual({ url: "/blocks/blk-1/status?session=s-1", body: { text: "Walking the plan" } });
    });
});

describe("wintos name", () => {
    test("proposes this session's name; you have a minute to change it", async () => {
        const d = await fakeDaemon("");
        const out = await new Promise<string>((resolve) =>
            require("child_process").execFile(CLI, ["name", "Retention", "backfill"], { env: { ...process.env, CLAUDE_CODE_SESSION_ID: "s-1", WAVETERM_BLOCKID: "blk-1", WINTOS_PORT: String(d.port) } }, (_e: unknown, so: string) => resolve(so))
        );
        expect(out.trim()).toBe("name: Retention backfill (the developer can change it with ⌥⌘N for a minute; carry on)");
        expect(d.seen[0]).toEqual({ url: "/blocks/blk-1/name?session=s-1", body: { text: "Retention backfill" } });
    });
});

describe("wintos lane and step", () => {
    const cli = (args: string[], port: number) =>
        new Promise<string>((resolve) => require("child_process").execFile(CLI, args, { env: { ...process.env, CLAUDE_CODE_SESSION_ID: "s-1", WAVETERM_BLOCKID: "blk-1", WINTOS_PORT: String(port) } }, (_e: unknown, so: string) => resolve(so)));
    test("lane sends the name and steps; step the step and its note", async () => {
        const d = await fakeDaemon("");
        expect((await cli(["lane", "feature", "Design", "?Approve spec", "Build"], d.port)).trim()).toBe("lane: feature (Design · ?Approve spec · Build)");
        expect((await cli(["step", "Build", "slice", "2", "of", "3"], d.port)).trim()).toBe("step: Build (slice 2 of 3)");
        expect(d.seen).toEqual([
            { url: "/blocks/blk-1/lane?session=s-1", body: { name: "feature", steps: ["Design", "?Approve spec", "Build"] } },
            { url: "/blocks/blk-1/step?session=s-1", body: { step: "Build", note: "slice 2 of 3" } },
        ]);
    });
    test("pr claims a PR for this pane's session, by link or owner/repo#n", async () => {
        const d = await fakeDaemon("https://github.com/o/r/pull/7");
        expect((await cli(["pr", "o/r#7"], d.port)).trim()).toBe("pr: https://github.com/o/r/pull/7");
        expect(d.seen).toEqual([{ url: "/blocks/blk-1/pr?session=s-1", body: { ref: "o/r#7", own: false } }]);
    });
    test("pr --own takes it over from whoever touched it first", async () => {
        const d = await fakeDaemon("https://github.com/o/r/pull/7");
        await cli(["pr", "--own", "o/r#7"], d.port);
        expect(d.seen[0].body).toEqual({ ref: "o/r#7", own: true });
    });
    test("todo lists the step's to-dos; todo done ticks one", async () => {
        const d = await fakeDaemon("");
        expect((await cli(["todo", "Narrow list", "Name search"], d.port)).trim()).toBe("todo: Narrow list · Name search");
        expect((await cli(["todo", "done", "Name search"], d.port)).trim()).toBe("todo done: Name search");
        expect(d.seen).toEqual([
            { url: "/blocks/blk-1/todo?session=s-1", body: { items: ["Narrow list", "Name search"] } },
            { url: "/blocks/blk-1/todo?session=s-1", body: { done: "Name search" } },
        ]);
    });
});

describe("wintos done", () => {
    test("ends this block's session turn as done", async () => {
        const d = await fakeDaemon("");
        const out = await new Promise<string>((resolve) =>
            require("child_process").execFile(CLI, ["done"], { env: { ...process.env, CLAUDE_CODE_SESSION_ID: "s-1", WAVETERM_BLOCKID: "blk-1", WINTOS_PORT: String(d.port) } }, (_e: unknown, so: string) => resolve(so))
        );
        expect(out.trim()).toBe("done: nothing waits on the developer");
        expect(d.seen[0]).toEqual({ url: "/blocks/blk-1/done?session=s-1", body: {} });
    });
});

describe("wintos ask", () => {
    const ask = async (args: string[]) => {
        const d = await fakeDaemon("");
        const r = await new Promise<{ out: string; code: number }>((resolve) =>
            require("child_process").execFile(CLI, ["ask", ...args], { env: { ...process.env, CLAUDE_CODE_SESSION_ID: "s-1", WAVETERM_BLOCKID: "blk-1", WINTOS_PORT: String(d.port) } }, (e: { code?: number } | null, so: string) => resolve({ out: so, code: e?.code ?? 0 }))
        );
        return { ...r, seen: d.seen };
    };

    test("sends what this block's session asks of the developer", async () => {
        const r = await ask(["decide", "two", "bands"]);
        expect([r.out.trim(), r.seen[0]]).toEqual(["asks the developer to decide: two bands", { url: "/blocks/blk-1/ask?session=s-1", body: { kind: "decide", text: "two bands" } }]);
    });

    test("a kind it doesn't know is refused before anything is sent", async () => {
        const r = await ask(["ponder"]);
        expect([r.code, r.seen]).toEqual([1, []]);
    });
});

describe("wintos wake", () => {
    const wake = async (args: string[], status = 200, reply = '{"pr":"https://github.com/o/r/pull/7","until":"released","prompt":"check prod"}') => {
        const seen: { url: string; body: unknown }[] = [];
        server = http.createServer((req, res) => {
            let b = "";
            req.on("data", (c) => (b += c));
            req.on("end", () => (seen.push({ url: req.url!, body: b && JSON.parse(b) }), (res.statusCode = status), res.end(reply)));
        });
        const port = await new Promise<number>((r) => server!.listen(0, "127.0.0.1", () => r((server!.address() as AddressInfo).port)));
        const r = await new Promise<{ out: string; err: string; code: number }>((resolve) =>
            require("child_process").execFile(CLI, ["wake", ...args], { env: { ...process.env, CLAUDE_CODE_SESSION_ID: "s-1", WAVETERM_BLOCKID: "blk-1", WINTOS_PORT: String(port) } }, (e: { code?: number } | null, so: string, se: string) => resolve({ out: so, err: se, code: e?.code ?? 0 }))
        );
        return { ...r, seen };
    };

    test("sends the event, the PR and the prompt, and tells the session to end its turn", async () => {
        const r = await wake(["released", "o/r#7", "check", "prod"]);
        expect(r.seen[0]).toEqual({ url: "/blocks/blk-1/wake?session=s-1", body: { until: "released", pr: "o/r#7", prompt: "check prod" } });
        expect(r.out).toContain("wakes when https://github.com/o/r/pull/7 is released: check prod\nNow end your turn");
    });

    test("too few arguments: refused before anything is sent, with the usage and examples", async () => {
        const r = await wake(["released", "o/r#7"]);
        expect([r.code, r.seen]).toEqual([1, []]);
        expect(r.err).toContain("need an event, a PR and a prompt (got 2 argument(s))");
        expect(r.err).toContain("e.g.  wintos wake green");
    });

    test("the daemon's reason for refusing is shown, with the usage", async () => {
        const r = await wake(["deployed", "o/r#7", "x"], 400, "unknown event \"deployed\": use one of green, merged, released");
        expect([r.code, r.err]).toEqual([1, expect.stringContaining("unknown event \"deployed\": use one of green, merged, released\nusage: wintos wake")]);
    });

    test("cancel", async () => {
        const r = await wake(["cancel"], 200, "cancelled");
        expect([r.seen[0].url, r.out.trim()]).toEqual(["/blocks/blk-1/wake/cancel?session=s-1", "cancelled"]);
    });
});
