import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { transcriptHistory } from "./backend/history";

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
        for (const query of ["24", "#24", "acme/widgets#24", "widgets#24", "https://github.com/acme/widgets/pull/24"])
            expect((await transcriptHistory([root], query)).map((h) => h.id)).toEqual(["synthetic"]);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
