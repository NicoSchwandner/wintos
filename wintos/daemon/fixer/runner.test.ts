import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { expect, test } from "vitest";
import type { PR } from "../prs/group";
import { fixKey } from "./plan";
import { Fixer, type FixRun } from "./runner";

const pr = { repo: "o/r", number: 7, url: "https://github.com/o/r/pull/7", author: "me", conflict: true, branch: "b7", head: "sha7" } as PR;
const run = (id: string, o: Partial<FixRun>): FixRun => ({ id, kind: "conflict", url: pr.url, head: pr.head, route: "fresh", at: 1, startedAt: 1, ...o });

function seeded(runs: FixRun[]): string {
    const root = mkdtempSync(join(tmpdir(), "fixer-"));
    mkdirSync(join(root, ".fixer"), { recursive: true });
    writeFileSync(join(root, ".fixer", "runs.jsonl"), runs.map((r) => JSON.stringify(r)).join("\n") + "\n");
    writeFileSync(join(root, ".fixer", "tried.json"), JSON.stringify([fixKey("conflict", pr)]));
    return root;
}

test("a run a restart cut off is ended once and its conflict tried again on the next refresh", () => {
    const root = seeded([run("cut", {})]);
    const fixer = new Fixer(root, () => {}, "true");
    expect(fixer.state().runs[0]).toMatchObject({ id: "cut", exit: null, result: expect.stringContaining("cut off") });
    expect(JSON.parse(readFileSync(join(root, ".fixer", "tried.json"), "utf8"))).toEqual([]);

    fixer.consider([pr], "me");
    expect(fixer.state().runs.map((r) => r.id)).toHaveLength(2);
    // The ending is on disk: the next restart neither reports nor retries it again.
    expect(new Fixer(root, () => {}, "true").state().runs.find((r) => r.id === "cut")?.endedAt).toBeGreaterThan(1);
});

test("a run that ended stays tried: the same head is not fixed twice", () => {
    const fixer = new Fixer(seeded([run("done", { endedAt: 2, exit: 0 })]), () => {}, "true");
    fixer.consider([pr], "me");
    expect(fixer.state().runs.map((r) => r.id)).toEqual(["done"]);
});
