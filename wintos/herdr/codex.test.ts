import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, expect, test, vi } from "vitest";
import { codexHistory, resumedCodex } from "./backend/codex";
const temps: string[] = [];
afterEach(async () => {
    vi.unstubAllEnvs();
    for (const t of temps.splice(0)) await rm(t, { recursive: true, force: true });
});

test("no-rg search streams large Codex rollouts and preserves exact PR boundaries across chunks", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-large-no-rg-"));
    temps.push(root);
    const directory = join(root, "archived_sessions");
    await mkdir(directory);
    const id = "55555555-5555-4555-8555-555555555555";
    const other = "66666666-6666-4666-8666-666666666666";
    const pr = "https://github.com/acme/widgets/pull/24";
    const meta = (value: string) =>
        JSON.stringify({ type: "session_meta", payload: { id: value, cwd: "/tmp/work" } }) + "\n";
    await writeFile(
        join(directory, `rollout-${id}.jsonl`),
        meta(id) +
            JSON.stringify({ message: "x".repeat(65530 - meta(id).length - '{"message":"'.length) + pr }) +
            "\n" +
            JSON.stringify({ padding: "x".repeat(17 * 1024 * 1024) })
    );
    await writeFile(
        join(directory, `rollout-${other}.jsonl`),
        meta(other) +
            JSON.stringify({
                message: "x".repeat(65536 - meta(other).length - '{"message":"'.length - pr.length) + pr + "0",
            }) +
            "\n"
    );
    vi.stubEnv("PATH", root);
    expect((await codexHistory(root, "widgets#24")).map((hit) => hit.id)).toEqual([id]);
});

test("Codex PR search works without rg, including archived matches outside preview windows", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-no-rg-history-"));
    temps.push(root);
    const dir = join(root, "archived_sessions");
    await mkdir(dir, { recursive: true });
    const id = "22222222-2222-4222-8222-222222222222";
    await writeFile(
        join(dir, `rollout-${id}.jsonl`),
        [
            JSON.stringify({ type: "session_meta", payload: { id, cwd: "/tmp/widgets" } }),
            JSON.stringify({ padding: "x".repeat(150_000) }),
            JSON.stringify({ message: "https://github.com/acme/widgets/pull/24" }),
            JSON.stringify({ padding: "x".repeat(150_000) }),
        ].join("\n")
    );
    vi.stubEnv("PATH", root);
    for (const query of [
        "24",
        "#24",
        "widgets#24",
        "acme/widgets#24",
        "https://github.com/acme/widgets/pull/24",
        "ACME/Widgets#24",
        "Widgets#24",
        "https://github.com/ACME/WIDGETS/pull/24",
    ])
        expect((await codexHistory(root, query)).map((h) => h.id)).toEqual([id]);
    expect(await codexHistory(root, "widgets#2")).toEqual([]);
});
test("finds Codex conversations by PR and name, retaining their resume directory and provider", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-history-"));
    temps.push(root);
    const dir = join(root, "sessions/2026/11/01");
    await mkdir(dir, { recursive: true });
    const id = "11111111-1111-4111-8111-111111111111";
    await writeFile(
        join(root, "session_index.jsonl"),
        JSON.stringify({ id, thread_name: "Repair widgets", updated_at: "2026-11-01T10:00:00Z" }) + "\n"
    );
    await writeFile(
        join(dir, `rollout-date-${id}.jsonl`),
        [
            JSON.stringify({ type: "session_meta", payload: { id, cwd: "/tmp/widgets" } }),
            JSON.stringify({
                type: "event_msg",
                payload: { type: "user_message", message: "Fix https://github.com/acme/widgets/pull/24" },
            }),
        ].join("\n")
    );
    const byPr = await codexHistory(root, "acme/widgets#24");
    expect(byPr).toHaveLength(1);
    expect(byPr[0]).toMatchObject({
        id,
        name: "Repair widgets",
        cwd: "/tmp/widgets",
        provider: "codex",
        prs: ["https://github.com/acme/widgets/pull/24"],
    });
    expect((await codexHistory(root, "repair")).map((r) => r.id)).toEqual([id]);
    expect(await codexHistory(root, "#2")).toEqual([]);
    expect((await codexHistory(root, "widgets#24")).map((r) => r.id)).toEqual([id]);
    for (const query of ["ACME/Widgets#24", "Widgets#24", "https://github.com/ACME/WIDGETS/pull/24"])
        expect((await codexHistory(root, query)).map((r) => r.id)).toEqual([id]);
});
test("a missing Codex history is empty and fresh argv has no guessed identity", async () => {
    expect(await codexHistory("/tmp/no-such-synthetic-codex-home", "")).toEqual([]);
    expect(resumedCodex({ foreground: { argv: ["codex"] } })).toBeUndefined();
    expect(resumedCodex({ foreground: { argv: ["codex", "resume", "11111111-1111-4111-8111-111111111111"] } })).toBe(
        "11111111-1111-4111-8111-111111111111"
    );
    expect(
        resumedCodex({ foreground: { argv: ["claude", "--resume", "11111111-1111-4111-8111-111111111111"] } })
    ).toBeUndefined();
});
