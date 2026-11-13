import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, expect, test, vi } from "vitest";
import { transcriptHistory, waveHistory } from "./backend/history";
import { createCompanion } from "./companion";

afterEach(() => vi.unstubAllEnvs());

test.each([
    { label: "paused", flags: { paused: 123 } },
    { label: "restored", flags: { restored: true } },
    { label: "paused and restored", flags: { paused: 123, restored: true } },
])("WintOS retains ownership of $label sessions over a stale shelf entry", async ({ flags }) => {
    const root = await mkdtemp(join(tmpdir(), "wave-owned-history-"));
    try {
        await writeFile(
            join(root, ".sessions.json"),
            JSON.stringify([
                { id: "owned-session", state: "idle", label: "Owned work", cwd: "/tmp/owned", lastAt: 10, ...flags },
            ])
        );
        await writeFile(
            join(root, ".shelf.json"),
            JSON.stringify({
                "/tmp/shelved": [
                    {
                        sessionId: "owned-session",
                        label: "Stale shelf",
                        script: "cd '/tmp/shelved' && claude --resume 'owned-session'",
                        at: 999,
                    },
                ],
            })
        );
        expect(waveHistory(root)).toEqual([
            expect.objectContaining({
                id: "owned-session",
                name: "Owned work",
                cwd: "/tmp/owned",
                live: true,
                lastAt: 10,
                resume: "cd '/tmp/owned' && claude --resume 'owned-session'",
            }),
        ]);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("WintOS ended sessions remain resumable and their shelf entry supplies archived metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "wave-ended-history-"));
    try {
        await writeFile(
            join(root, ".sessions.json"),
            JSON.stringify([
                {
                    id: "ended-session",
                    state: "ended",
                    label: "Earlier work",
                    cwd: "/tmp/earlier",
                    lastAt: 10,
                    paused: 123,
                    restored: true,
                    prs: ["https://github.com/acme/widgets/pull/24"],
                },
            ])
        );
        await writeFile(
            join(root, ".shelf.json"),
            JSON.stringify({
                "/tmp/shelved": [
                    {
                        sessionId: "ended-session",
                        label: "Archived work",
                        script: "cd '/tmp/shelved' && claude --resume 'ended-session'",
                        at: 20,
                    },
                ],
            })
        );
        expect(waveHistory(root)).toEqual([
            expect.objectContaining({
                id: "ended-session",
                name: "Archived work",
                cwd: "/tmp/shelved",
                live: false,
                lastAt: 20,
                resume: "cd '/tmp/shelved' && claude --resume 'ended-session'",
                prs: ["https://github.com/acme/widgets/pull/24"],
            }),
        ]);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("Claude transcript fallback finds exact PR numbers as well as full URLs", async () => {
    const root = await mkdtemp(join(tmpdir(), "claude-pr-history-"));
    try {
        const folder = join(root, "projects", "-tmp-work");
        await mkdir(folder, { recursive: true });
        await writeFile(
            join(folder, "synthetic.jsonl"),
            JSON.stringify({
                cwd: "/tmp/work",
                timestamp: "2026-01-01T10:00:00Z",
                message: { content: "https://github.com/acme/widgets/pull/24" },
            }) + "\n"
        );
        for (const query of [
            "24",
            "#24",
            "acme/widgets#24",
            "widgets#24",
            "https://github.com/acme/widgets/pull/24",
            "ACME/Widgets#24",
            "Widgets#24",
            "https://github.com/ACME/WIDGETS/pull/24",
        ])
            expect((await transcriptHistory([root], query)).map((h) => h.id)).toEqual(["synthetic"]);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("Claude PR history excludes subagent transcripts", async () => {
    const root = await mkdtemp(join(tmpdir(), "claude-subagent-history-"));
    try {
        const folder = join(root, "projects", "-tmp-work");
        await mkdir(join(folder, "parent", "subagents"), { recursive: true });
        const row = JSON.stringify({
            cwd: "/tmp/work",
            message: { content: "https://github.com/acme/widgets/pull/24" },
        });
        await writeFile(join(folder, "parent.jsonl"), row);
        await writeFile(join(folder, "parent", "subagents", "agent-child.jsonl"), row);
        const hits = await transcriptHistory([root], "widgets#24");
        expect(hits.map((h) => h.id)).toEqual(["parent"]);
        expect(hits[0].configDir).toBe(root);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("Claude history keeps launch cwd across later cwd rows and head-tail windows", async () => {
    const root = await mkdtemp(join(tmpdir(), "claude-cwd-history-"));
    try {
        const folder = join(root, "projects", "-tmp-launch");
        await mkdir(folder, { recursive: true });
        await writeFile(
            join(folder, "parent.jsonl"),
            [
                JSON.stringify({ cwd: "/tmp/launch", timestamp: "2026-01-01T10:00:00Z" }),
                JSON.stringify({ padding: "x".repeat(300_000) }),
                JSON.stringify({
                    cwd: "/tmp/elsewhere",
                    timestamp: "2026-01-02T10:00:00Z",
                    customTitle: "Updated title",
                    message: { content: "https://github.com/acme/widgets/pull/24" },
                }),
            ].join("\n")
        );
        expect((await transcriptHistory([root], "24"))[0]).toMatchObject({
            cwd: "/tmp/launch",
            name: "Updated title",
            lastAt: Date.parse("2026-01-02T10:00:00Z"),
        });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("Claude history finds PRs without rg and still excludes subagents and oversized files", async () => {
    const root = await mkdtemp(join(tmpdir(), "claude-no-rg-history-"));
    try {
        const folder = join(root, "projects", "-tmp-work");
        await mkdir(join(folder, "parent", "subagents"), { recursive: true });
        const row = JSON.stringify({
            cwd: "/tmp/work",
            message: { content: "https://github.com/acme/widgets/pull/24" },
        });
        await writeFile(join(folder, "parent.jsonl"), row);
        await writeFile(join(folder, "parent", "subagents", "agent-child.jsonl"), row);
        await writeFile(join(folder, "oversized.jsonl"), row + "\n" + "x".repeat(16 * 1024 * 1024));
        vi.stubEnv("PATH", root);
        for (const query of [
            "24",
            "widgets#24",
            "acme/widgets#24",
            "https://github.com/acme/widgets/pull/24",
            "ACME/Widgets#24",
            "Widgets#24",
            "https://github.com/ACME/WIDGETS/pull/24",
        ])
            expect((await transcriptHistory([root], query)).map((h) => h.id)).toEqual(["parent"]);
        expect(await transcriptHistory([root], "widgets#2")).toEqual([]);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("default Claude history does not invent an account override", async () => {
    const home = await mkdtemp(join(tmpdir(), "claude-default-history-"));
    try {
        vi.stubEnv("HOME", home);
        const root = join(home, ".claude");
        const folder = join(root, "projects", "-tmp-work");
        await mkdir(folder, { recursive: true });
        await writeFile(
            join(folder, "parent.jsonl"),
            JSON.stringify({ cwd: "/tmp/work", message: { content: "https://github.com/acme/widgets/pull/24" } })
        );
        const hit = (await transcriptHistory([root], "24"))[0];
        expect(hit.configDir).toBeUndefined();
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});

test("search keeps live results alongside both transcript readers when rg is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "companion-no-rg-history-"));
    const stateRoot = join(root, "state");
    const claudeRoot = join(root, "claude");
    const codexRoot = join(root, "codex");
    let service: Awaited<ReturnType<typeof createCompanion>>;
    try {
        await mkdir(stateRoot);
        await mkdir(join(claudeRoot, "projects", "-tmp-work"), { recursive: true });
        await mkdir(join(codexRoot, "sessions"), { recursive: true });
        const pr = "https://github.com/acme/widgets/pull/24";
        await writeFile(
            join(stateRoot, "state.json"),
            JSON.stringify({
                sessions: {
                    "live-parent": {
                        id: "live-parent",
                        name: "Live parent",
                        prs: [pr],
                        source: "herdr",
                        lastAt: 1,
                        terminal: "t1",
                        configDir: claudeRoot,
                        cwd: "/tmp/work",
                        live: true,
                    },
                },
                terminals: { t1: "live-parent" },
                wakes: {},
                opening: {},
            })
        );
        await writeFile(
            join(claudeRoot, "projects", "-tmp-work", "saved-parent.jsonl"),
            JSON.stringify({ cwd: "/tmp/work", message: { content: pr } })
        );
        const codexId = "33333333-3333-4333-8333-333333333333";
        await writeFile(
            join(codexRoot, "sessions", `rollout-${codexId}.jsonl`),
            [
                JSON.stringify({ type: "session_meta", payload: { id: codexId, cwd: "/tmp/work" } }),
                JSON.stringify({ message: pr }),
            ].join("\n")
        );
        vi.stubEnv("PATH", root);
        service = await createCompanion({
            root: stateRoot,
            codexHome: codexRoot,
            wintosRoot: join(root, "wave"),
            pollMs: 0,
            exec: async () => ({ code: 0, stdout: JSON.stringify({ terminals: [] }), stderr: "" }),
        });
        const response = await new Promise<{ status: number; hits: { id: string; live: boolean }[] }>((resolve) => {
            const request = Object.assign(Readable.from([]), {
                method: "GET",
                url: "/search?q=Widgets%2324",
                headers: { host: "127.0.0.1:7732" },
                socket: { localPort: 7732 },
            });
            let status: number;
            service.server.emit("request", request, {
                writeHead: (code: number) => {
                    status = code;
                },
                end: (body: string) => resolve({ status, hits: JSON.parse(body) }),
            });
        });
        expect(response.status).toBe(200);
        expect(response.hits.map((hit) => hit.id).sort()).toEqual([codexId, "live-parent", "saved-parent"]);
        expect(response.hits.find((hit) => hit.id === "live-parent")?.live).toBe(true);
    } finally {
        await service?.close();
        await rm(root, { recursive: true, force: true });
    }
});
