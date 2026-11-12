import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, expect, test } from "vitest";
import { codexHistory, resumedCodex } from "./backend/codex";
const temps: string[] = [];
afterEach(async () => {
    for (const t of temps.splice(0)) await rm(t, { recursive: true, force: true });
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
