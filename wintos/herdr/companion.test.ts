import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createCompanion, type CompanionOptions } from "./companion";

const pr = "https://github.com/acme/widgets/pull/42";
const run = "https://github.com/acme/widgets/actions/runs/123";
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
    vi.unstubAllEnvs();
    for (const f of cleanups.splice(0).reverse()) await f();
});
async function fixture(options: CompanionOptions = {}) {
    const dir = await mkdtemp(join(tmpdir(), "companion-test-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const calls: [string, string[]][] = [];
    const observed = {
        state: "live",
        foreground: { pid: 101, argv: ["claude"] },
        status: { app: "claude-code", state: "idle" },
    };
    let conclusion = "success",
        status = "completed",
        sendCode = 0;
    const exec = async (cmd: string, args: string[]) => {
        calls.push([cmd, args]);
        if (cmd === "hc")
            return { code: args[0] === "send" ? sendCode : 0, stdout: JSON.stringify(observed), stderr: "send failed" };
        if (cmd === "ps" && args[0] === "-p")
            return { code: 0, stdout: args[1] === "101" ? "1 /tmp/codex" : "101 /bin/node", stderr: "" };
        if (cmd === "gh") return { code: 0, stdout: JSON.stringify({ status, conclusion }), stderr: "" };
        return { code: 0, stdout: "{}", stderr: "" };
    };
    const root = options.root ?? join(dir, "own");
    const wintosRoot = options.wintosRoot ?? join(dir, "wave");
    await mkdir(wintosRoot.replace(/^~/, homedir()), { recursive: true });
    const service = await createCompanion({
        root,
        wintosRoot,
        pollMs: 0,
        codexHome: false,
        exec,
        prNow: async () => ({ state: "OPEN", checks: "green", released: false }),
        ...options,
    });
    const port = await service.listen(0);
    cleanups.push(() => service.close());
    const request = async (path: string, body?: unknown, headers: Record<string, string> = {}) => {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, {
            method: body === undefined ? "GET" : "POST",
            headers: { "Content-Type": "application/json", ...headers },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { status: res.status, body: (await res.json()) as any };
    };
    const event = (payload = {}, terminal = "t1") =>
        request("/events", {
            terminal,
            terminalPid: 101,
            configDir: join(dir, "claude"),
            payload: { hook_event_name: "SessionStart", session_id: "session-a", cwd: dir, ...payload },
        });
    const wake = (event = "green", target = pr) =>
        request("/wake", { terminal: "t1", event, target, prompt: "Continue the task" });
    return {
        service,
        request,
        event,
        wake,
        calls,
        observed,
        root,
        wintosRoot,
        dir,
        port,
        runState: (s: string, c: string) => {
            status = s;
            conclusion = c;
        },
        sendCode: (n: number) => {
            sendCode = n;
        },
    };
}

describe("companion HTTP boundary", () => {
    test("indexes hook output, persists metadata and matches PR shorthand without substring collisions", async () => {
        const f = await fixture();
        expect((await f.request("/health")).status).toBe(200);
        expect(
            (
                await f.event({
                    title: "Repair widgets",
                    transcript_path: join(f.dir, "a.jsonl"),
                    tool_name: "Bash",
                    tool_input: { command: "gh pr create" },
                    tool_response: { stdout: `${pr}\n${pr}` },
                })
            ).status
        ).toBe(200);
        for (const q of [pr, "acme/widgets#42", "#42", "42", "widgets", "Repair"]) {
            const hits = (await f.request(`/search?q=${encodeURIComponent(q)}`)).body;
            expect(hits).toHaveLength(1);
            expect(hits[0]).toMatchObject({
                id: "session-a",
                name: "Repair widgets",
                prs: [pr],
                source: "herdr",
                terminal: "t1",
            });
        }
        expect((await f.request("/search?q=4")).body).toEqual([]);
        await f.service.close();
        const restarted = await fixture({ root: f.root, wintosRoot: f.wintosRoot });
        expect((await restarted.request("/search?q=42")).body[0].name).toBe("Repair widgets");
    });
    test("rejects browser writes, malformed payloads and bodies above one MiB as JSON errors", async () => {
        const f = await fixture();
        for (const [body, headers, want] of [
            [{}, { Origin: "https://example.test" }, 403],
            [{}, { "Content-Type": "text/plain" }, 415],
            [{}, {}, 400],
            [{ terminal: "t1", payload: null }, {}, 400],
            [{ x: "x".repeat(1048576) }, {}, 413],
        ] as const) {
            const result = await f.request("/events", body, headers);
            expect(result.status).toBe(want);
            expect(result.body.error).toEqual(expect.any(String));
        }
        expect((await f.request("/missing")).status).toBe(404);
    });
    test("focuses matching live Claude, protects reused terminals and suppresses duplicate resumes", async () => {
        const f = await fixture();
        await f.event();
        expect((await f.request("/open", { id: "session-a" })).status).toBe(200);
        expect(f.calls.at(-1)).toEqual(["herdr-app", ["do", "agent.focus", "--terminal", "t1"]]);
        await f.event({ session_id: "session-b" });
        await f.request("/open", { id: "session-a" });
        await f.request("/open", { id: "session-a" });
        const opens = f.calls.filter(([, args]) => args.includes("tab.new"));
        expect(opens).toHaveLength(1);
        expect(JSON.parse(opens[0][1].at(-1)!)).toMatchObject({
            argv: ["env", `CLAUDE_CONFIG_DIR=${join(f.dir, "claude")}`, "claude", "--resume", "session-a"],
            folder: f.dir,
        });
    });
    test("reads Wave sessions and shelf read-only, blocks live sessions and extracts closed resume", async () => {
        const f = await fixture();
        const script = "cd '/work dir' && CLAUDE_CONFIG_DIR='/configs/test' claude --resume 'closed-a'";
        const sessions = JSON.stringify([
            { id: "live-a", state: "working", blockId: "block-a", lastAt: 50, prs: [pr], label: "Live widgets" },
            { id: "closed-a", state: "ended", lastAt: 40, prs: [pr] },
        ]);
        await writeFile(join(f.wintosRoot, ".sessions.json"), sessions);
        await writeFile(
            join(f.wintosRoot, ".shelf.json"),
            JSON.stringify({
                "/work dir": [{ sessionId: "closed-a", script, label: "Archived widgets", at: 45, prs: [pr] }],
            })
        );
        expect((await f.request("/search?q=42")).body).toHaveLength(2);
        expect((await f.request("/open", { id: "live-a" })).status).toBe(409);
        expect(f.calls.some(([, a]) => a.includes("tab.new"))).toBe(false);
        expect((await f.request("/open", { id: "closed-a" })).status).toBe(200);
        expect(JSON.parse(f.calls.at(-1)![1].at(-1)!)).toMatchObject({
            folder: "/work dir",
            argv: ["env", "CLAUDE_CONFIG_DIR=/configs/test", "claude", "--resume", "closed-a"],
        });
        expect(await readFile(join(f.wintosRoot, ".sessions.json"), "utf8")).toBe(sessions);
    });
    test("reads transcripts only for exact PR queries and deduplicates indexed sessions", async () => {
        const f = await fixture();
        const projects = join(f.dir, "claude", "projects", "-work");
        await mkdir(projects, { recursive: true });
        await writeFile(
            join(projects, "transcript-a.jsonl"),
            JSON.stringify({
                sessionId: "transcript-a",
                cwd: "/work",
                timestamp: "2026-11-12T10:00:00Z",
                message: { content: [{ type: "tool_result", content: pr }] },
            }) + "\n"
        );
        await f.event();
        expect((await f.request("/search?q=")).body.map((h: any) => h.id)).toEqual(["session-a"]);
        expect((await f.request("/search?q=widgets")).body).toEqual([]);
        expect((await f.request("/search?q=acme/widgets%2342")).body[0]).toMatchObject({
            id: "transcript-a",
            source: "transcript",
            prs: [pr],
            cwd: "/work",
        });
    });
});

describe("persistent wakes", () => {
    test.each(["green", "merged", "released", "comments", "rereview"])(
        "uses registered PR event %s and delivers only once",
        async (event) => {
            const f = await fixture({
                prNow: async (_url, _who, events) => ({
                    state: events.includes("comments") || events.includes("rereview") ? "OPEN" : "MERGED",
                    checks: "green",
                    released: true,
                    requestedAgain: true,
                    feedbackAt: Date.now() + 1000,
                }),
            });
            await f.event();
            expect((await f.wake(event)).status).toBe(200);
            await f.service.poll();
            await f.service.poll();
            expect((await f.request("/wakes")).body[0]).toMatchObject({
                status: "delivered",
                event,
                sessionId: "session-a",
            });
            expect(f.calls.filter(([, a]) => a[0] === "send")).toHaveLength(1);
            expect(f.calls.find(([, a]) => a[0] === "send")![1]).toContain("--if");
        }
    );
    test.each([
        ["in_progress", "success", "pending"],
        ["completed", "success", "success"],
        ["completed", "failure", "failure"],
        ["completed", "cancelled", "cancelled"],
    ])("exact run %s/%s signals %s", async (status, conclusion, expected) => {
        const f = await fixture();
        await f.event();
        f.runState(status, conclusion);
        await f.wake("run", run);
        await f.service.poll();
        const w = (await f.request("/wakes")).body[0];
        expect(w.status).toBe(expected === "pending" ? "pending" : "delivered");
        if (expected !== "pending") expect(w.outcome).toBe(expected);
        const send = f.calls.find(([, a]) => a[0] === "send");
        if (expected === "failure" || expected === "cancelled") {
            expect(send![1].join(" ")).toContain(expected);
            expect(send![1]).not.toContain("Continue the task");
        }
        expect(f.calls.find(([c]) => c === "gh")![1]).toEqual(["api", "repos/acme/widgets/actions/runs/123"]);
    });
    test("retries errors, persists pending and delivered records across restart", async () => {
        const f = await fixture();
        await f.event();
        await f.wake();
        f.sendCode(1);
        await f.service.poll();
        expect((await f.request("/wakes")).body[0]).toMatchObject({
            status: "pending",
            error: expect.stringContaining("send failed"),
        });
        await f.service.close();
        const next = await fixture({ root: f.root, wintosRoot: f.wintosRoot });
        await next.service.poll();
        expect((await next.request("/wakes")).body[0].status).toBe("delivered");
        await next.service.close();
        const last = await fixture({ root: f.root, wintosRoot: f.wintosRoot });
        await last.service.poll();
        expect(last.calls.filter(([, a]) => a[0] === "send")).toHaveLength(0);
    });
    test("never sends into busy, unrelated or reused terminals", async () => {
        const f = await fixture();
        await f.event();
        await f.wake();
        for (const status of ["working", "blocked", "error"]) {
            f.observed.status.state = status;
            await f.service.poll();
        }
        f.observed.status.state = "idle";
        f.observed.status.app = "shell";
        await f.service.poll();
        f.observed.status.app = "claude-code";
        await f.event({ session_id: "session-b" });
        await f.service.poll();
        await f.service.poll();
        expect(f.calls.filter(([, a]) => a[0] === "send")).toHaveLength(0);
        expect(f.calls.filter(([, a]) => a.includes("tab.new"))).toHaveLength(1);
        await f.event({}, "t2");
        await f.service.poll();
        expect(f.calls.find(([, a]) => a[0] === "send")![1][1]).toBe("t2");
    });
    test("cancels only the latest session's wakes and rejects mismatched explicit ids", async () => {
        const f = await fixture();
        await f.event();
        await f.wake();
        expect(
            (
                await f.request("/wake", {
                    terminal: "t1",
                    sessionId: "wrong",
                    event: "run",
                    target: run,
                    prompt: "next",
                })
            ).status
        ).toBe(409);
        await f.wake("cancel");
        await f.service.poll();
        expect((await f.request("/wakes")).body[0].status).toBe("cancelled");
        expect(f.calls.filter(([, a]) => a[0] === "send")).toHaveLength(0);
    });
});

describe("review regressions", () => {
    test("indexes prompt and command PRs with the first prompt line as title", async () => {
        const f = await fixture();
        await f.event({ hook_event_name: "UserPromptSubmit", prompt: `Review widgets ${pr}\nDetails` });
        await f.event({ tool_name: "Bash", tool_input: { command: "gh pr view https://github.com/acme/api/pull/9" } });
        const hits = (await f.request("/search?q=9")).body;
        expect(hits[0]).toMatchObject({
            name: `Review widgets ${pr}`,
            prs: [pr, "https://github.com/acme/api/pull/9"],
        });
        expect((await f.wake("green", "acme/api#9")).body.target).toBe("https://github.com/acme/api/pull/9");
    });
    test("caches discovered transcripts for open and refuses recent or running ones", async () => {
        let clock = Date.parse("2026-11-12T20:00:00Z");
        const f = await fixture({ now: () => clock });
        const folder = join(f.dir, "claude", "projects", "-work");
        await mkdir(folder, { recursive: true });
        await f.event();
        await writeFile(
            join(folder, "old-a.jsonl"),
            JSON.stringify({ cwd: "/old", timestamp: "2026-11-01T10:00:00Z", message: { content: pr } })
        );
        await writeFile(
            join(folder, "new-a.jsonl"),
            JSON.stringify({ cwd: "/new", timestamp: "2026-11-12T20:00:00Z", message: { content: pr } })
        );
        await utimes(join(folder, "old-a.jsonl"), new Date("2026-11-01"), new Date("2026-11-01"));
        await utimes(join(folder, "new-a.jsonl"), new Date(clock), new Date(clock));
        expect((await f.request("/search?q=42")).body).toHaveLength(2);
        expect((await f.request("/open", { id: "new-a" })).status).toBe(409);
        expect((await f.request("/open", { id: "old-a" })).status).toBe(200);
        expect(JSON.parse(f.calls.at(-1)![1].at(-1)!)).toMatchObject({
            folder: "/old",
            argv: ["env", `CLAUDE_CONFIG_DIR=${join(f.dir, "claude")}`, "claude", "--resume", "old-a"],
        });
        expect((await f.request("/open", { id: "old-a" })).body.opening).toBe(true);
        clock += 61_000;
        expect((await f.request("/open", { id: "old-a" })).status).toBe(200);
        expect(f.calls.filter(([, a]) => a.includes("tab.new"))).toHaveLength(2);
    });
    test("a restarted service can retry an expired resume lease", async () => {
        let clock = 100_000;
        const f = await fixture({ now: () => clock });
        await f.event();
        await f.event({ session_id: "session-b" });
        await f.request("/open", { id: "session-a" });
        await f.service.close();
        clock += 61_000;
        const next = await fixture({ root: f.root, wintosRoot: f.wintosRoot, now: () => clock });
        await next.request("/open", { id: "session-a" });
        expect(next.calls.filter(([, a]) => a.includes("tab.new"))).toHaveLength(1);
    });
    test("done requires a fresh recheck and never uses unsupported --if done or --force", async () => {
        let gets = 0;
        const f = await fixture({
            exec: async (_cmd, args) => {
                if (args[0] === "get")
                    return {
                        code: 0,
                        stdout: JSON.stringify({
                            state: "live",
                            foreground: { pid: 101, argv: ["claude"] },
                            status: { app: "claude-code", state: ++gets === 1 ? "done" : "working" },
                        }),
                        stderr: "",
                    };
                throw new Error("Must not send while working");
            },
        });
        await f.event();
        await f.wake();
        await f.service.poll();
        expect(gets).toBe(2);
        expect((await f.request("/wakes")).body[0].status).toBe("pending");
    });
    test("GitHub errors remain pending, expiration and mismatched targets are explicit", async () => {
        let clock = 1000;
        const f = await fixture({ now: () => clock, prNow: async () => undefined });
        await f.event();
        await f.wake();
        await f.service.poll();
        expect((await f.request("/wakes")).body[0]).toMatchObject({
            status: "pending",
            error: expect.stringContaining("retry"),
        });
        expect((await f.wake("run", pr)).status).toBe(400);
        clock += 10 * 86400000;
        await f.service.poll();
        expect((await f.request("/wakes")).body[0].status).toBe("expired");
    });
});

describe("CLI entry", () => {
    test("forwards wake arguments and environment identity; cancel uses the same boundary", async () => {
        const { runCli } = await import("./main");
        const f = await fixture();
        await f.event();
        const env = {
            HC_TERMINAL_ID: "t1",
            CLAUDE_CODE_SESSION_ID: "session-a",
            WINTOS_HERDR_COMPANION_URL: `http://127.0.0.1:${f.port}`,
        };
        await runCli(["wake", "green", "acme/widgets#42", "Continue", "here"], env, () => {});
        expect((await f.request("/wakes")).body[0]).toMatchObject({
            target: pr,
            prompt: "Continue here",
            sessionId: "session-a",
        });
        await runCli(["wake", "cancel"], env, () => {});
        expect((await f.request("/wakes")).body[0].status).toBe("cancelled");
        await expect(
            runCli(["wake", "green", pr, "next"], { ...env, CLAUDE_CODE_SESSION_ID: "other" }, () => {})
        ).rejects.toThrow(/matching latest/);
        await expect(runCli(["wake", "cancel"], {}, () => {})).rejects.toThrow(/HC_TERMINAL_ID/);
    });
});

test("concurrent opens share a lease while process evidence is being checked", async () => {
    let opens = 0;
    const f = await fixture({
        exec: async (cmd, args) => {
            if (cmd === "ps") {
                await new Promise((resolve) => setTimeout(resolve, 20));
                return { code: 0, stdout: "", stderr: "" };
            }
            if (args.includes("tab.new")) opens++;
            return { code: 0, stdout: "{}", stderr: "" };
        },
    });
    await f.event();
    await f.event({ session_id: "session-b" });
    await Promise.all([f.request("/open", { id: "session-a" }), f.request("/open", { id: "session-a" })]);
    expect(opens).toBe(1);
});

test("resume refuses matching live processes and failed process inspection", async () => {
    let unavailable = false;
    const f = await fixture({
        exec: async (cmd) =>
            cmd === "ps"
                ? { code: unavailable ? 1 : 0, stdout: "claude --resume session-a", stderr: "unavailable" }
                : { code: 0, stdout: "{}", stderr: "" },
    });
    await f.event();
    await f.event({ session_id: "session-b" });
    expect((await f.request("/open", { id: "session-a" })).status).toBe(409);
    unavailable = true;
    expect((await f.request("/open", { id: "session-a" })).status).toBe(500);
});

test("a reused terminal during an hc lookup cannot receive the old session's prompt", async () => {
    let replace: () => Promise<unknown> = async () => {};
    let sends = 0;
    const f = await fixture({
        exec: async (_cmd, args) => {
            if (args[0] === "get") await replace();
            if (args[0] === "send") sends++;
            return {
                code: 0,
                stdout: JSON.stringify({
                    state: "live",
                    foreground: { pid: 101, argv: ["claude"] },
                    status: { app: "claude-code", state: "idle" },
                }),
                stderr: "",
            };
        },
    });
    await f.event();
    expect((await f.wake()).status).toBe(200);
    replace = () => f.event({ session_id: "session-b" });
    await f.service.poll();
    expect(sends).toBe(0);
    expect((await f.request("/wakes")).body[0].status).toBe("pending");
});

test("an exact run API failure is retained and can later deliver success", async () => {
    let unavailable = true;
    const f = await fixture({
        exec: async (cmd) => {
            if (cmd === "gh")
                return {
                    code: unavailable ? 1 : 0,
                    stdout: JSON.stringify({ status: "completed", conclusion: "success" }),
                    stderr: "API offline",
                };
            return {
                code: 0,
                stdout: JSON.stringify({
                    state: "live",
                    foreground: { pid: 101, argv: ["claude"] },
                    status: { app: "claude-code", state: "idle" },
                }),
                stderr: "",
            };
        },
    });
    await f.event();
    await f.wake("run", run);
    await f.service.poll();
    expect((await f.request("/wakes")).body[0]).toMatchObject({
        status: "pending",
        error: expect.stringContaining("API offline"),
    });
    unavailable = false;
    await f.service.poll();
    expect((await f.request("/wakes")).body[0]).toMatchObject({ status: "delivered", outcome: "success" });
});

test("discovers resumed Codex terminals and delivers a wake to Codex, without Claude hooks", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const calls: [string, string[]][] = [];
    const f = await fixture({
        codexHome: "/tmp/synthetic-no-codex-history",
        exec: async (cmd, args) => {
            calls.push([cmd, args]);
            if (args[0] === "ls")
                return {
                    code: 0,
                    stdout: JSON.stringify({ terminals: [{ address: "t8", state: "live", agent: "codex" }] }),
                    stderr: "",
                };
            if (args[0] === "get")
                return {
                    code: 0,
                    stdout: JSON.stringify({
                        state: "live",
                        cwd: "/tmp/widgets",
                        labels: { "herdr.tab": "tb1" },
                        foreground: { argv: ["codex", "resume", id] },
                        status: { app: "codex", state: "done" },
                    }),
                    stderr: "",
                };
            return { code: 0, stdout: "{}", stderr: "" };
        },
    });
    const hits = (await f.request("/search?q=")).body;
    expect(hits).toEqual(
        expect.arrayContaining([expect.objectContaining({ id, provider: "codex", terminal: "t8", live: true })])
    );
    expect(
        (
            await f.request("/wake", {
                terminal: "t8",
                sessionId: id,
                event: "green",
                target: pr,
                prompt: "Codex continue",
            })
        ).status
    ).toBe(200);
    await f.service.poll();
    expect(calls.filter(([cmd, args]) => cmd === "hc" && args[0] === "send").map(([, args]) => args[1])).toEqual([
        "t8",
    ]);
});
test("closed Codex sessions resume with Codex and a live conflicting conversation is refused", async () => {
    const f = await fixture();
    await f.request("/events", {
        terminal: "t9",
        configDir: "/tmp/codex-config",
        provider: "codex",
        payload: { session_id: "codex-old", hook_event_name: "SessionEnd", cwd: "/tmp/widgets" },
    });
    expect((await f.request("/open", { id: "codex-old" })).status).toBe(200);
    const args = JSON.parse(f.calls.at(-1)![1].at(-1)!);
    expect(args.argv).toEqual(["env", "CODEX_HOME=/tmp/codex-config", "codex", "resume", "codex-old"]);
});

test("wintos wake in a fresh Codex session registers its thread identity before setting the wake", async () => {
    const { runCli } = await import("./main");
    const f = await fixture();
    f.observed.status.app = "codex";
    await runCli(
        ["wake", "run", run, "Continue after deploy"],
        {
            HC_TERMINAL_ID: "t1",
            CODEX_THREAD_ID: "codex-fresh",
            CODEX_HOME: "/tmp/synthetic-codex",
            WINTOS_HERDR_COMPANION_URL: `http://127.0.0.1:${f.port}`,
        },
        () => {}
    );
    expect((await f.request("/wakes")).body[0]).toMatchObject({ sessionId: "codex-fresh", event: "run" });
    expect((await f.request("/search?q=codex-fresh")).body[0]).toMatchObject({ provider: "codex" });
});

describe("independent review fixes", () => {
    test.each([
        {
            label: "contradictory resume without a recorded PID",
            recordedPid: undefined,
            pid: 202,
            argv: ["claude", "--resume", "session-b"],
        },
        {
            label: "contradictory resume after PID reuse",
            recordedPid: 101,
            pid: 101,
            argv: ["claude", "--resume=session-b"],
        },
        { label: "changed process after a missed hook", recordedPid: 101, pid: 202, argv: ["claude"] },
        { label: "Claude app alone", recordedPid: undefined, pid: 202, argv: ["claude"] },
    ])("refuses focus and delivery with $label", async ({ recordedPid, pid, argv }) => {
        const f = await fixture();
        await f.request("/events", {
            terminal: "t1",
            terminalPid: recordedPid,
            configDir: "/tmp/synthetic-claude",
            payload: { session_id: "session-a", hook_event_name: "SessionStart", cwd: "/tmp" },
        });
        f.observed.foreground.argv = ["claude", "--resume", "session-a"];
        expect((await f.wake()).status).toBe(200);
        f.observed.foreground = { pid, argv };
        expect((await f.request("/open", { id: "session-a" })).status).toBe(409);
        await f.service.poll();
        expect((await f.request("/wakes")).body[0].status).toBe("pending");
        expect(f.calls.filter(([, args]) => args[0] === "send" || args.includes("agent.focus"))).toEqual([]);
    });
    test("exact foreground Claude resume identity can bind a legacy hook without PID", async () => {
        const f = await fixture();
        await f.request("/events", {
            terminal: "t1",
            configDir: "/tmp/synthetic-claude",
            payload: { session_id: "session-a", hook_event_name: "SessionStart", cwd: "/tmp" },
        });
        f.observed.foreground.argv = ["/bin/claude", "--resume", "session-a"];
        await f.wake();
        await f.service.poll();
        expect((await f.request("/wakes")).body[0].status).toBe("delivered");
    });
    test("normal hook captures the actual foreground PID without losing hook fields", async () => {
        const f = await fixture();
        const bin = join(f.dir, "bin");
        await mkdir(bin);
        const captured = join(f.dir, "hook.json");
        await writeFile(
            join(bin, "hc"),
            `#!/bin/sh\n[ "$1" = get ] && [ "$2" = t1 ] && [ "$3" = --json ] || exit 1\nprintf '%s\\n' '{"state":"live","foreground":{"pid":101,"argv":["claude"]},"status":{"app":"claude-code","state":"idle"}}'\n`,
            { mode: 0o755 }
        );
        await writeFile(join(bin, "curl"), '#!/bin/sh\ncat > "$CAPTURE"\n', { mode: 0o755 });
        await writeFile(
            join(bin, "ps"),
            '#!/bin/sh\ncase "$2" in command=) if [ "$4" = 101 ]; then echo /bin/claude; else echo /bin/sh; fi ;; ppid=) echo 101 ;; esac\n',
            { mode: 0o755 }
        );
        const payload = {
            session_id: "session-a",
            hook_event_name: "SessionStart",
            cwd: "/tmp",
            transcript_path: "/tmp/session-a.jsonl",
            prompt: "Review widgets",
            extra_hook_field: { synthetic: true },
        };
        const child = execFile("/bin/sh", [join(process.cwd(), "wintos/herdr/hook.sh")], {
            env: {
                PATH: `${bin}:${process.env.PATH}`,
                HOME: f.dir,
                HC_TERMINAL_ID: "t1",
                CLAUDE_CONFIG_DIR: "/tmp/synthetic-claude",
                CAPTURE: captured,
            },
        });
        const completed = new Promise<void>((resolve, reject) => {
            child.once("error", reject);
            child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`hook exit ${code}`))));
        });
        child.stdin!.end(JSON.stringify(payload));
        await completed;
        const body = JSON.parse(await readFile(captured, "utf8"));
        expect(body).toMatchObject({ terminalPid: 101, payload });
        expect((await f.request("/events", body)).status).toBe(200);
        await f.wake();
        f.observed.foreground.pid = 202;
        await f.service.poll();
        expect((await f.request("/wakes")).body[0].status).toBe("pending");
    });
    test.each(["failure", "cancelled"])(
        "a delayed run success is rechecked through pending rerun to %s",
        async (conclusion) => {
            const f = await fixture();
            await f.event();
            await f.wake("run", run);
            f.observed.status.state = "working";
            await f.service.poll();
            expect((await f.request("/wakes")).body[0].outcome).toBe("success");
            f.runState("in_progress", "");
            f.observed.status.state = "idle";
            await f.service.poll();
            expect((await f.request("/wakes")).body[0]).toMatchObject({ status: "pending" });
            expect((await f.request("/wakes")).body[0].due).toBeUndefined();
            expect((await f.request("/wakes")).body[0].outcome).toBeUndefined();
            expect(f.calls.filter(([, args]) => args[0] === "send")).toEqual([]);
            f.runState("completed", conclusion);
            await f.service.poll();
            const wake = (await f.request("/wakes")).body[0];
            expect(wake).toMatchObject({ status: "delivered", outcome: conclusion });
            const prompt = f.calls.find(([, args]) => args[0] === "send")![1][2];
            expect(prompt).toContain(conclusion);
            expect(prompt).not.toContain("Continue the task");
        }
    );
    test("persisted due run success is not delivered during a GitHub error after restart", async () => {
        const f = await fixture();
        await f.event();
        await f.wake("run", run);
        f.observed.status.state = "working";
        await f.service.poll();
        await f.service.close();
        let sends = 0;
        const next = await fixture({
            root: f.root,
            wintosRoot: f.wintosRoot,
            exec: async (cmd, args) => {
                if (cmd === "gh") return { code: 1, stdout: "", stderr: "API unavailable" };
                if (args[0] === "send") sends++;
                return {
                    code: 0,
                    stdout: JSON.stringify({
                        state: "live",
                        foreground: { pid: 101, argv: ["claude"] },
                        status: { app: "claude-code", state: "idle" },
                    }),
                    stderr: "",
                };
            },
        });
        await next.service.poll();
        expect((await next.request("/wakes")).body[0]).toMatchObject({
            status: "pending",
            error: expect.stringContaining("API unavailable"),
        });
        expect(sends).toBe(0);
    });
});

async function codexFixture() {
    const home = await mkdtemp(join(tmpdir(), "companion-codex-fix-"));
    cleanups.push(() => rm(home, { recursive: true, force: true }));
    const id = "11111111-1111-4111-8111-111111111111";
    await mkdir(join(home, "sessions"));
    await writeFile(
        join(home, "sessions", `rollout-${id}.jsonl`),
        JSON.stringify({ type: "session_meta", payload: { id, cwd: "/tmp/synthetic-widgets" } }) + "\n"
    );
    const calls: [string, string[]][] = [];
    const wires: Record<string, any> = {};
    const codex = (pid: number, argv = ["codex"]) => ({
        state: "live",
        cwd: "/tmp/synthetic-widgets",
        labels: { "herdr.tab": "tab-synthetic" },
        foreground: { pid, argv },
        status: { app: "codex", state: "idle" },
    });
    let autoResume = false;
    const f = await fixture({
        codexHome: home,
        now: () => Date.now() + 3600000,
        exec: async (cmd, args) => {
            calls.push([cmd, args]);
            if (cmd === "ps" && args[0] === "-p")
                return { code: 0, stdout: args[1] === "101" ? "1 /tmp/codex" : "101 /bin/node", stderr: "" };
            if (cmd === "hc" && args[0] === "ls")
                return {
                    code: 0,
                    stdout: JSON.stringify({
                        terminals: Object.entries(wires).map(([address, wire]) => ({
                            address,
                            state: wire.state,
                            agent: wire.status?.app,
                        })),
                    }),
                    stderr: "",
                };
            if (cmd === "hc" && args[0] === "get")
                return { code: wires[args[1]] ? 0 : 3, stdout: JSON.stringify(wires[args[1]] ?? {}), stderr: "" };
            if (cmd === "herdr-app" && args.includes("tab.new") && autoResume)
                wires.t2 = codex(202, ["codex", "resume", id]);
            return { code: 0, stdout: "{}", stderr: "" };
        },
    });
    return {
        ...f,
        id,
        home,
        wires,
        calls,
        codex,
        autoResume: () => {
            autoResume = true;
        },
    };
}

describe("Codex wake lifecycle safety", () => {
    test("polling discovers a wake-resumed Codex thread and delivers without searching", async () => {
        const f = await codexFixture();
        f.wires.t1 = f.codex(101);
        expect(
            (
                await f.request("/wake", {
                    terminal: "t1",
                    codexId: f.id,
                    callerPid: 900,
                    event: "green",
                    target: pr,
                    prompt: "Resume work",
                })
            ).status
        ).toBe(200);
        f.wires.t1 = { state: "finished" };
        f.autoResume();
        await f.service.poll();
        await f.service.poll();
        await f.service.poll();
        expect((await f.request("/wakes")).body[0].status).toBe("delivered");
        expect(f.calls.filter(([, args]) => args.includes("tab.new"))).toHaveLength(1);
        expect(f.calls.filter(([cmd, args]) => cmd === "hc" && args[0] === "send").map(([, args]) => args[1])).toEqual([
            "t2",
        ]);
    });
    test("an old transcript cannot authorize resume beside an unbound fresh Codex process", async () => {
        const f = await codexFixture();
        f.wires.t1 = f.codex(101);
        expect((await f.request("/search?q=")).body.some((hit: any) => hit.id === f.id)).toBe(true);
        const result = await f.request("/open", { id: f.id });
        expect(result.status).toBe(409);
        expect(result.body.error).toMatch(/unbound.*Codex/i);
        expect(result.body.error).toContain("wintos wake");
        expect(f.calls.filter(([, args]) => args.includes("tab.new"))).toHaveLength(0);
        f.wires.t1 = { state: "finished" };
        expect((await f.request("/open", { id: f.id })).status).toBe(200);
        const launch = f.calls.find(([, args]) => args.includes("tab.new"))![1];
        expect(JSON.parse(launch.at(-1)!).argv).toEqual(["env", `CODEX_HOME=${f.home}`, "codex", "resume", f.id]);
    });
    test("open refreshes evidence if a fresh unbound Codex appeared after search", async () => {
        const f = await codexFixture();
        await f.request("/search?q=");
        f.wires.t1 = f.codex(101);
        expect((await f.request("/open", { id: f.id })).status).toBe(409);
        expect(f.calls.filter(([, args]) => args.includes("tab.new"))).toEqual([]);
    });
    test("an explicitly registered fresh Codex is not confused with a different closed thread", async () => {
        const f = await codexFixture();
        f.wires.t1 = f.codex(101);
        await f.request("/search?q=");
        expect(
            (
                await f.request("/wake", {
                    terminal: "t1",
                    codexId: "22222222-2222-4222-8222-222222222222",
                    callerPid: 900,
                    event: "green",
                    target: pr,
                    prompt: "Continue other work",
                })
            ).status
        ).toBe(200);
        expect((await f.request("/open", { id: f.id })).status).toBe(200);
    });
    test.each(["claude", "codex"])("mixed inherited environment routes to actual %s", async (provider) => {
        const { runCli } = await import("./main");
        const f = await codexFixture();
        if (provider === "claude") {
            f.wires.t1 = {
                state: "live",
                foreground: { pid: 101, argv: ["claude"] },
                status: { app: "claude-code", state: "idle" },
            };
            await f.event();
        } else f.wires.t1 = f.codex(101);
        await runCli(
            ["wake", "green", pr, "Continue native work"],
            {
                HC_TERMINAL_ID: "t1",
                CLAUDE_CODE_SESSION_ID: "session-a",
                CODEX_THREAD_ID: f.id,
                CODEX_HOME: f.home,
                WINTOS_HERDR_COMPANION_URL: `http://127.0.0.1:${f.port}`,
            },
            () => {}
        );
        await f.service.poll();
        expect((await f.request("/wakes")).body[0]).toMatchObject({
            sessionId: provider === "claude" ? "session-a" : f.id,
            status: "delivered",
        });
    });
});

describe("Codex wake without terminal environment", () => {
    test("resolves the exact native resumed thread without HC_TERMINAL_ID", async () => {
        const f = await codexFixture();
        f.wires.t8 = f.codex(808, ["codex", "resume", f.id]);
        const result = await f.request("/wake", {
            codexId: f.id,
            sessionId: "inherited-claude-id",
            callerPid: 900,
            event: "green",
            target: pr,
            prompt: "Continue resumed thread",
        });
        expect(result.status).toBe(200);
        expect(result.body).toMatchObject({ terminal: "t8", sessionId: f.id });
        await f.service.poll();
        expect((await f.request("/wakes")).body[0].status).toBe("delivered");
        expect(f.calls.filter(([, args]) => args[0] === "send").map(([, args]) => args[1])).toEqual(["t8"]);
        expect(f.calls.some(([cmd]) => cmd === "ps")).toBe(false);
    });
    test.each(["fresh", "different-resume"])(
        "refuses an unconfirmed %s thread without guessing from callerPid",
        async (kind) => {
            const f = await codexFixture();
            f.wires.t8 = f.codex(
                808,
                kind === "fresh" ? ["codex"] : ["codex", "resume", "22222222-2222-4222-8222-222222222222"]
            );
            const result = await f.request("/wake", {
                codexId: f.id,
                callerPid: 808,
                event: "green",
                target: pr,
                prompt: "Do not guess",
            });
            expect(result.status).toBe(409);
            expect(result.body.error).toMatch(/HC_TERMINAL_ID/);
            expect((await f.request("/wakes")).body).toEqual([]);
            expect(f.calls.some(([cmd]) => cmd === "ps")).toBe(false);
        }
    );
});

describe("Copilot round one regressions", () => {
    test("launch directory and unset default account survive later cwd changes", async () => {
        const f = await fixture();
        const event = (payload: object, launchDir?: string) =>
            f.request("/events", {
                terminal: "t1",
                terminalPid: 101,
                configOverride: null,
                launchDir,
                payload: { session_id: "session-a", hook_event_name: "SessionStart", cwd: "/tmp/current", ...payload },
            });
        expect((await event({}, "/tmp/launch")).status).toBe(200);
        await event({ hook_event_name: "PostToolUse", cwd: "/tmp/moved" });
        await event({ hook_event_name: "SessionEnd", cwd: "/tmp/elsewhere" });
        expect((await f.request("/search?q=session-a")).body[0].cwd).toBe("/tmp/launch");
        expect((await f.request("/open", { id: "session-a" })).status).toBe(200);
        expect(JSON.parse(f.calls.at(-1)![1].at(-1)!)).toMatchObject({
            folder: "/tmp/launch",
            argv: ["env", "-u", "CLAUDE_CONFIG_DIR", "claude", "--resume", "session-a"],
        });
    });
    test("later cwd changes cannot replace the first launch cwd without CLAUDE_PROJECT_DIR", async () => {
        const f = await fixture();
        await f.event();
        await f.event({ cwd: "/tmp/changed" });
        expect((await f.request("/search?q=session-a")).body[0].cwd).toBe(f.dir);
    });
    test("an explicit default-root override stays explicit", async () => {
        const f = await fixture();
        const config = join(homedir(), ".claude");
        await f.request("/events", {
            terminal: "t1",
            configDir: config,
            configOverride: config,
            launchDir: "/tmp/launch",
            payload: { session_id: "session-a", hook_event_name: "SessionEnd", cwd: "/tmp/current" },
        });
        expect((await f.request("/open", { id: "session-a" })).status).toBe(200);
        expect(JSON.parse(f.calls.at(-1)![1].at(-1)!).argv).toEqual([
            "env",
            `CLAUDE_CONFIG_DIR=${config}`,
            "claude",
            "--resume",
            "session-a",
        ]);
    });
    test.each([false, true])("WintOS resume script controls account override (%s)", async (explicit) => {
        const f = await fixture();
        const config = "/tmp/script-account";
        await f.request("/events", {
            terminal: "t1",
            configDir: "/tmp/stale-account",
            configOverride: "/tmp/stale-account",
            payload: { session_id: "session-a", hook_event_name: "SessionEnd", cwd: "/tmp/stale" },
        });
        await writeFile(
            join(f.wintosRoot, ".sessions.json"),
            JSON.stringify([
                {
                    id: "session-a",
                    state: "ended",
                    lastAt: 1,
                    resume: `cd '/tmp/script-root' && ${explicit ? `CLAUDE_CONFIG_DIR='${config}' ` : ""}claude --resume 'session-a'`,
                },
            ])
        );
        expect((await f.request("/open", { id: "session-a" })).status).toBe(200);
        expect(JSON.parse(f.calls.at(-1)![1].at(-1)!)).toMatchObject({
            folder: "/tmp/script-root",
            argv: explicit
                ? ["env", `CLAUDE_CONFIG_DIR=${config}`, "claude", "--resume", "session-a"]
                : ["env", "-u", "CLAUDE_CONFIG_DIR", "claude", "--resume", "session-a"],
        });
    });
    test("rereview resolves team display name and paginated members without a PR list", async () => {
        vi.stubEnv("WINTOS_TEAM", "acme/team-widgets");
        vi.stubEnv("WINT_GITHUB_USERNAME", "synthetic-reviewer");
        const calls: string[][] = [];
        const f = await fixture({
            exec: async (cmd, args) => {
                if (cmd === "gh") {
                    calls.push(args);
                    return {
                        code: 0,
                        stdout: args.includes("--paginate") ? "synthetic-member\nsecond-member\n" : "Team Widgets\n",
                        stderr: "",
                    };
                }
                return {
                    code: 0,
                    stdout: JSON.stringify({
                        state: "live",
                        foreground: { pid: 101, argv: ["claude"] },
                        status: { app: "claude-code", state: "idle" },
                    }),
                    stderr: "",
                };
            },
            prNow: async (_url, who) => ({
                state: "OPEN",
                checks: "pending",
                released: false,
                requestedAgain:
                    who.me === "synthetic-reviewer" &&
                    who.team?.includes("Team Widgets") &&
                    who.team?.includes("synthetic-member"),
            }),
        });
        await f.event();
        await f.wake("rereview");
        await f.service.poll();
        expect((await f.request("/wakes")).body[0].status).toBe("delivered");
        expect(calls).toEqual([
            ["api", "orgs/acme/teams/team-widgets", "--jq", ".name"],
            ["api", "--paginate", "orgs/acme/teams/team-widgets/members", "--jq", ".[].login"],
        ]);
    });
});

describe("rereview team identity", () => {
    test.each([
        { label: "successful lookup is cached", spec: "acme/team-x", event: "rereview", fail: "", lookups: 2 },
        { label: "team-name failure is retried", spec: "acme/team-x", event: "rereview", fail: "name", lookups: 3 },
        {
            label: "member failure leaves no partial cache",
            spec: "acme/team-x",
            event: "rereview",
            fail: "members",
            lookups: 4,
        },
        { label: "green does not resolve teams", spec: "acme/team-x", event: "green", fail: "", lookups: 0 },
        { label: "unset team is omitted", spec: "", event: "rereview", fail: "", lookups: 0 },
        { label: "invalid team is omitted", spec: "not-a-team-spec", event: "rereview", fail: "", lookups: 0 },
    ])("$label", async ({ spec, event, fail, lookups }) => {
        vi.stubEnv("WINTOS_TEAM", spec);
        vi.stubEnv("WINT_GITHUB_USERNAME", "synthetic-reviewer");
        const calls: string[][] = [];
        const identities: { me: string; team?: string[] }[] = [];
        let failed = false;
        const f = await fixture({
            exec: async (command, args) => {
                if (command === "gh") {
                    calls.push(args);
                    const part = args.includes("--paginate") ? "members" : "name";
                    if (part === fail && !failed) {
                        failed = true;
                        return { code: 1, stdout: "", stderr: "Synthetic transient team failure" };
                    }
                    return {
                        code: 0,
                        stdout: part === "members" ? "fixture-one\nfixture-two\n" : "Fixture Team\n",
                        stderr: "",
                    };
                }
                return {
                    code: 0,
                    stdout: JSON.stringify({
                        state: "live",
                        foreground: { pid: 101, argv: ["claude"] },
                        status: { app: "claude-code", state: "working" },
                    }),
                    stderr: "",
                };
            },
            prNow: async (_url, who) => {
                identities.push(who);
                return { state: "OPEN", checks: "pending", released: false };
            },
        });
        await f.event();
        expect((await f.wake(event)).status).toBe(200);
        for (let i = 0; i < 3; i++) {
            await f.service.poll();
            const wake = (await f.request("/wakes")).body[0];
            expect(wake.status).toBe("pending");
            expect(wake.error).toBeUndefined();
        }
        expect(identities).toHaveLength(3);
        expect(calls).toHaveLength(lookups);
        if (lookups) {
            expect(identities.at(-1)).toEqual({
                me: "synthetic-reviewer",
                team: ["Fixture Team", "fixture-one", "fixture-two"],
            });
            expect(calls.slice(-2)).toEqual([
                ["api", "orgs/acme/teams/team-x", "--jq", ".name"],
                ["api", "--paginate", "orgs/acme/teams/team-x/members", "--jq", ".[].login"],
            ]);
            if (fail) expect(identities[0]).toEqual({ me: "synthetic-reviewer" });
        } else {
            expect(identities).toEqual(Array(3).fill({ me: "synthetic-reviewer" }));
        }
    });
});

describe("loopback request boundary", () => {
    test.each(["/health", "/search?q=42", "/wakes"])(
        "rejects browser origins and rebound hosts before GET %s",
        async (route) => {
            const f = await fixture();
            const get = (headers: Record<string, string | undefined>) =>
                new Promise<number>((resolve, reject) => {
                    const request = httpRequest(
                        { hostname: "127.0.0.1", port: f.port, path: route, headers, setHost: headers.Host !== "" },
                        (response) => {
                            response.resume();
                            response.on("end", () => resolve(response.statusCode ?? 0));
                        }
                    );
                    request.on("error", reject);
                    request.end();
                });
            for (const headers of [
                { Origin: "https://example.test" },
                { Host: "rebound.example.test:7732" },
                { Host: "127.0.0.1:1" },
                { Host: "" },
            ])
                expect(await get(headers), JSON.stringify(headers)).toBe(403);
            expect(await get({})).toBe(200);
            expect(await get({ Host: `localhost:${f.port}` })).toBe(200);
        }
    );
});

describe("fresh Codex caller identity", () => {
    test.each([
        { label: "foreground ancestor", command: "1 /tmp/codex", wanted: 200 },
        { label: "nested child Codex", command: "101 /tmp/codex", wanted: 409, ancestor: 202 },
        { label: "shared Codex app server", command: "1 /tmp/codex", wanted: 409, ancestor: 202 },
        { label: "missing caller evidence", command: "1 /tmp/codex", wanted: 409, caller: 0 },
        { label: "missing process", command: "", wanted: 409 },
        { label: "malformed process evidence", command: "invalid", wanted: 409 },
        { label: "caller PID is not a number", command: "1 /tmp/codex", wanted: 409, caller: "900" },
        { label: "non-Codex caller cycle", command: "900 /bin/sh", wanted: 409, ancestor: 900 },
    ])("$label", async ({ command, wanted, ancestor = 101, caller = 900 }) => {
        const f = await fixture({
            exec: async (name, args) => {
                if (name === "ps")
                    return {
                        code: command ? 0 : 1,
                        stdout: args[1] === "900" ? `${ancestor} /bin/node` : command,
                        stderr: "",
                    };
                return {
                    code: 0,
                    stdout: JSON.stringify({
                        state: "live",
                        foreground: { pid: 101, argv: ["codex"] },
                        status: { app: "codex", state: "idle" },
                    }),
                    stderr: "",
                };
            },
        });
        expect(
            (
                await f.request("/wake", {
                    terminal: "t1",
                    codexId: "fresh-thread",
                    callerPid: caller,
                    event: "green",
                    target: pr,
                    prompt: "Continue",
                })
            ).status
        ).toBe(wanted);
        expect((await f.request("/wakes")).body).toHaveLength(wanted === 200 ? 1 : 0);
    });
});

describe("history ownership and current file evidence", () => {
    test("expands the home prefix before reading WintOS history", async () => {
        const home = await mkdtemp(join(tmpdir(), "herdr-home-root-"));
        cleanups.push(() => rm(home, { recursive: true, force: true }));
        vi.stubEnv("HOME", home);
        const f = await fixture({ wintosRoot: "~/wave" });
        await writeFile(
            join(home, "wave", ".sessions.json"),
            JSON.stringify([{ id: "saved-tilde", state: "ended", lastAt: 1, prs: [pr] }])
        );
        expect((await f.request("/search?q=42")).body.map((hit: any) => hit.id)).toContain("saved-tilde");
    });
    test.each([{ paused: true }, { restored: true }, { paused: true, restored: true }])(
        "retained WintOS ownership blocks resume: %j",
        async (flags) => {
            const f = await fixture();
            await writeFile(
                join(f.wintosRoot, ".sessions.json"),
                JSON.stringify([{ id: "owned", state: "waiting", cwd: "/tmp/work", lastAt: 1, ...flags }])
            );
            expect((await f.request("/open", { id: "owned" })).status).toBe(409);
            expect(f.calls.some(([, args]) => args.includes("tab.new"))).toBe(false);
        }
    );
    test("an externally active Codex rollout cannot resume using cached old metadata", async () => {
        const f = await codexFixture();
        await f.request("/search?q=");
        const current = new Date(Date.now() + 3600000);
        await utimes(join(f.home, "sessions", `rollout-${f.id}.jsonl`), current, current);
        const result = await f.request("/open", { id: f.id });
        expect(result.status).toBe(409);
        expect(result.body.error).toContain("Transcript is recent");
        expect(f.calls.some(([, args]) => args.includes("tab.new"))).toBe(false);
    });
});

function heldLookup() {
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
        entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    return {
        started,
        release: () => release(),
        wait: async () => {
            entered();
            await held;
        },
    };
}

describe("wake replacement and terminal reuse", () => {
    test.each(["green", "cancel"])("a reused terminal cannot %s the previous conversation", async (event) => {
        const f = await fixture();
        await f.event();
        await f.wake();
        f.observed.foreground.pid = 202;
        expect((await f.wake(event)).status).toBe(409);
        expect((await f.request("/wakes")).body[0].status).toBe("pending");
    });
    test.each(["green", "cancel"])("mapping changes during lookup reject %s", async (event) => {
        const gate = heldLookup();
        let armed = false;
        const f = await fixture({
            exec: async (cmd, args) => {
                if (cmd === "hc" && args[0] === "get" && armed) {
                    armed = false;
                    await gate.wait();
                }
                return {
                    code: 0,
                    stdout: JSON.stringify({
                        state: "live",
                        foreground: { pid: 101, argv: ["claude"] },
                        status: { app: "claude-code", state: "idle" },
                    }),
                    stderr: "",
                };
            },
        });
        await f.event();
        await f.wake();
        armed = true;
        const request = f.wake(event);
        try {
            expect(await Promise.race([gate.started.then(() => "lookup"), request.then(() => "finished")])).toBe(
                "lookup"
            );
            await f.event({ session_id: "session-b" });
        } finally {
            gate.release();
        }
        expect((await request).status).toBe(409);
        expect((await f.request("/wakes")).body[0].status).toBe("pending");
    });
    test.each(["github", "terminal"])("a replacement suppresses an obsolete wake held at %s", async (stage) => {
        const gate = heldLookup();
        let armed = false;
        const pause = async (at: string) => {
            if (armed && stage === at) {
                armed = false;
                await gate.wait();
            }
        };
        const calls: [string, string[]][] = [];
        const f = await fixture({
            exec: async (cmd, args) => {
                calls.push([cmd, args]);
                if (cmd === "hc" && args[0] === "get") await pause("terminal");
                return {
                    code: 0,
                    stdout: JSON.stringify({
                        state: "live",
                        foreground: { pid: 101, argv: ["claude"] },
                        status: { app: "claude-code", state: "idle" },
                    }),
                    stderr: "",
                };
            },
            prNow: async () => {
                await pause("github");
                return { state: "OPEN", checks: "green", released: false };
            },
        });
        await f.event();
        await f.wake();
        armed = true;
        const polling = f.service.poll();
        try {
            await gate.started;
            expect(
                (await f.request("/wake", { terminal: "t1", event: "green", target: pr, prompt: "Replacement prompt" }))
                    .status
            ).toBe(200);
        } finally {
            gate.release();
        }
        await polling;
        expect(calls.filter(([, args]) => args[0] === "send")).toEqual([]);
        await f.service.poll();
        const sent = calls.filter(([, args]) => args[0] === "send");
        expect(sent).toHaveLength(1);
        expect(sent[0][1][2]).toContain("Replacement prompt");
    });
    test.each([undefined, "Old title"])(
        "a refreshed Codex title replaces %s without losing its live binding",
        async (oldTitle) => {
            const f = await codexFixture();
            const path = join(f.home, "session_index.jsonl");
            if (oldTitle)
                await writeFile(
                    path,
                    JSON.stringify({ id: f.id, thread_name: oldTitle, updated_at: new Date().toISOString() })
                );
            f.wires.t1 = f.codex(101, ["codex", "resume", f.id]);
            await f.request("/search?q=");
            await writeFile(
                path,
                JSON.stringify({ id: f.id, thread_name: "Updated title", updated_at: new Date().toISOString() })
            );
            const result = await f.request("/search?q=Updated%20title");
            expect(result.body).toHaveLength(1);
            expect(result.body[0]).toMatchObject({ name: "Updated title", terminal: "t1", provider: "codex" });
        }
    );
});

describe("final race regressions", () => {
    test.each(["ancestry", "initial lookup", "final lookup", "foreground only"])(
        "a Codex wake rejected after %s preserves the newer binding",
        async (stage) => {
            const gate = heldLookup();
            let armed = false, lookups = 0, pid = 101, clock = 100;
            const f = await fixture({
                now: () => clock,
                exec: async (cmd, args) => {
                    if (cmd === "ps") {
                        if (armed && ["ancestry", "foreground only"].includes(stage)) {
                            armed = false;
                            await gate.wait();
                        }
                        return { code: 0, stdout: args[1] === "900" ? "101 /bin/node" : "1 /tmp/codex", stderr: "" };
                    }
                    const wire = {
                        state: "live",
                        foreground: { pid, argv: ["codex"] },
                        status: { app: "codex", state: "idle" },
                    };
                    if (cmd === "hc" && args[0] === "get") {
                        lookups++;
                        if (armed && ((stage === "initial lookup" && lookups === 1) || (stage === "final lookup" && lookups === 2))) {
                            armed = false;
                            await gate.wait();
                        }
                    }
                    return { code: 0, stdout: JSON.stringify(wire), stderr: "" };
                },
            });
            const register = (id: string, terminalPid: number) => f.request("/events", {
                terminal: "t1", terminalPid, provider: "codex", configDir: join(f.dir, "codex"),
                payload: { session_id: id, hook_event_name: "SessionStart", cwd: f.dir },
            });
            await register("thread-a", 101);
            const original = JSON.parse(await readFile(join(f.root, "state.json"), "utf8")).sessions["thread-a"];
            armed = true;
            const request = f.request("/wake", {
                terminal: "t1", codexId: "thread-a", callerPid: 900, event: "green", target: pr, prompt: "Continue A",
            });
            try {
                expect(await Promise.race([gate.started.then(() => "held"), request.then(() => "finished")])).toBe("held");
                pid = 202;
                clock = 200;
                if (stage !== "foreground only") await register("thread-b", 202);
            } finally {
                gate.release();
            }
            expect((await request).status).toBe(409);
            const persisted = JSON.parse(await readFile(join(f.root, "state.json"), "utf8"));
            expect(persisted.terminals.t1).toBe(stage === "foreground only" ? "thread-a" : "thread-b");
            expect(persisted.sessions["thread-a"]).toEqual(original);
            expect((await f.request("/wakes")).body).toEqual([]);
        }
    );

    test.each(["", "   ", undefined])("an unavailable indexed title %j keeps the known title and live binding", async (title) => {
        const f = await codexFixture();
        const path = join(f.home, "session_index.jsonl");
        await writeFile(path, JSON.stringify({ id: f.id, thread_name: "Meaningful title" }) + "\n");
        f.wires.t1 = f.codex(101, ["codex", "resume", f.id]);
        expect((await f.request("/search?q=")).body[0].name).toBe("Meaningful title");
        await writeFile(path, title == null ? "" : JSON.stringify({ id: f.id, thread_name: title }) + "\n");
        const refreshed = await f.request(`/search?q=${f.id}`);
        expect(refreshed.body[0]).toMatchObject({ name: "Meaningful title", terminal: "t1", terminalPid: 101, live: true });
        expect((await f.request("/search?q=Meaningful%20title")).body[0].id).toBe(f.id);
    });

    test("a history fallback still names a previously unknown session", async () => {
        const f = await codexFixture();
        const result = await f.request("/search?q=");
        expect(result.body[0]).toMatchObject({ name: "synthetic-widgets", id: f.id });
    });

    test("a history fallback replaces a registered ID placeholder without losing its binding", async () => {
        const f = await codexFixture();
        f.wires.t1 = f.codex(101, ["codex", "resume", f.id]);
        expect((await f.request("/wake", {
            terminal: "t1", codexId: f.id, event: "green", target: pr, prompt: "Continue",
        })).status).toBe(200);
        const result = await f.request("/search?q=");
        expect(result.body[0]).toMatchObject({ name: "synthetic-widgets", id: f.id, terminal: "t1", live: true });
    });

    test.each([
        ["ended", "cancel"], ["ended", "replace"], ["ended", "rebind"],
        ["finished", "cancel"], ["finished", "replace"], ["finished", "rebind"],
    ])("%s recovery held at process inspection stops after %s", async (recovery, change) => {
        const gate = heldLookup();
        const calls: [string, string[]][] = [];
        let finished = false;
        const f = await fixture({
            exec: async (cmd, args) => {
                calls.push([cmd, args]);
                if (cmd === "ps") {
                    await gate.wait();
                    return { code: 0, stdout: "", stderr: "" };
                }
                return {
                    code: 0,
                    stdout: JSON.stringify({
                        state: finished ? "finished" : "live",
                        foreground: { pid: 101, argv: ["claude"] },
                        status: { app: "claude-code", state: "idle" },
                    }),
                    stderr: "",
                };
            },
        });
        await f.event();
        expect((await f.wake()).status).toBe(200);
        if (recovery === "ended") await f.event({ hook_event_name: "SessionEnd" });
        else finished = true;
        const polling = f.service.poll();
        try {
            await gate.started;
            finished = false;
            await f.event();
            if (change === "cancel") expect((await f.wake("cancel")).status).toBe(200);
            if (change === "replace") expect((await f.request("/wake", {
                terminal: "t1", event: "green", target: pr, prompt: "Replacement prompt",
            })).status).toBe(200);
        } finally {
            gate.release();
        }
        await polling;
        expect(calls.filter(([, args]) => args.includes("tab.new"))).toEqual([]);
        expect(JSON.parse(await readFile(join(f.root, "state.json"), "utf8")).opening["session-a"]).toBeUndefined();
        await f.service.poll();
        const sent = calls.filter(([, args]) => args[0] === "send");
        expect(sent).toHaveLength(change === "cancel" ? 0 : 1);
        if (change === "replace") expect(sent[0][1][2]).toContain("Replacement prompt");
    });
});

describe("waiting sessions", () => {
    test("exposes only pending waits for the current terminal binding, without prompts", async () => {
        const f = await fixture();
        await f.event();
        await f.wake();
        expect((await f.request("/waiting")).body).toEqual([{ terminal: "t1", event: "green", target: pr }]);
        await f.service.poll();
        expect((await f.request("/waiting")).body).toEqual([]);
    });
    test("does not transfer an old session's wait to a new session in the same terminal", async () => {
        const f = await fixture();
        await f.event();
        await f.wake();
        await f.event({ session_id: "session-b" });
        expect((await f.request("/waiting")).body).toEqual([]);
    });
    test("expired waits leave the section without waiting for the next GitHub poll", async () => {
        let now = Date.now();
        const f = await fixture({ now: () => now });
        await f.event();
        const wake = (await f.wake()).body;
        now = wake.expires + 1;
        expect((await f.request("/waiting")).body).toEqual([]);
    });
});

test("cancelling an Actions run wait removes it immediately", async () => {
    const f = await fixture();
    await f.event();
    await f.wake("run", run);
    expect((await f.request("/waiting")).body).toEqual([{ terminal: "t1", event: "run", target: run }]);
    await f.request("/wake", { terminal: "t1", event: "cancel" });
    expect((await f.request("/waiting")).body).toEqual([]);
});

test.each([
    { pid: 202, argv: ["claude"] },
    { pid: 101, argv: ["claude", "--resume=session-b"] },
])("a missed hook does not label a replacement conversation Waiting (%j)", async (foreground) => {
    const f = await fixture();
    await f.event();
    await f.wake();
    f.observed.foreground = foreground;
    expect((await f.request("/waiting")).body).toEqual([]);
});
test("an unreachable terminal cannot retain a Waiting label", async () => {
    let fail = false;
    const f = await fixture({
        exec: async () => {
            if (fail) throw Error("offline");
            return {
                code: 0,
                stderr: "",
                stdout: JSON.stringify({
                    state: "live",
                    foreground: { pid: 101, argv: ["claude"] },
                    status: { app: "claude-code", state: "idle" },
                }),
            };
        },
    });
    await f.event();
    await f.wake();
    fail = true;
    expect((await f.request("/waiting")).body).toEqual([]);
});

test("replacing and cancelling a wake during identity lookup cannot retain Waiting", async () => {
    let hold = false,
        release: () => void,
        entered: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const started = new Promise<void>((resolve) => {
        entered = resolve;
    });
    const f = await fixture({
        exec: async () => {
            if (hold) {
                hold = false;
                entered();
                await gate;
            }
            return {
                code: 0,
                stderr: "",
                stdout: JSON.stringify({
                    state: "live",
                    foreground: { pid: 101, argv: ["claude"] },
                    status: { app: "claude-code", state: "idle" },
                }),
            };
        },
    });
    await f.event();
    await f.wake();
    hold = true;
    const pending = f.request("/waiting");
    await started;
    await f.wake();
    await f.request("/wake", { terminal: "t1", event: "cancel" });
    release();
    expect((await pending).body).toEqual([]);
});
