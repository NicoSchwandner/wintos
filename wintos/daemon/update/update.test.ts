import { execFileSync } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { expect, test, vi } from "vitest";
import { updateWatch } from "./update";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const commit = (repo: string, n: number) => (writeFileSync(join(repo, "f"), String(n)), git(repo, "add", "f"), git(repo, "commit", "-qm", `c${n}`));

test("counts the commits the checkout gained after the start, and says when it changes", async () => {
    const repo = mkdtempSync(join(tmpdir(), "wintos-update-"));
    git(repo, "init", "-q");
    for (const [k, v] of [["user.name", "t"], ["user.email", "t@example.com"], ["commit.gpgsign", "false"]]) git(repo, "config", k, v);
    commit(repo, 0);
    const changed = vi.fn();
    const w = updateWatch(repo, changed, 20);
    commit(repo, 1);
    commit(repo, 2);
    await vi.waitFor(() => expect(w.behind()).toBe(2));
    expect(changed).toHaveBeenCalled();
    w.stop();
});

test("outside a git checkout it is never behind", () => {
    const w = updateWatch(mkdtempSync(join(tmpdir(), "wintos-noupdate-")), () => {});
    expect(w.behind()).toBe(0);
});
