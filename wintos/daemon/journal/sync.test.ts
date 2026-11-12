import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, test } from "vitest";
import { syncJournal } from "./sync";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

// A journal repo with its remote: journal/ holds the day files, the rest of the repo is notes.
const setup = () => {
    const base = mkdtempSync(join(tmpdir(), "journal-sync-"));
    const remote = join(base, "remote.git");
    const repo = join(base, "repo");
    git(base, "init", "-q", "--bare", "-b", "main", remote);
    git(base, "clone", "-q", remote, repo);
    for (const [k, v] of [["user.name", "t"], ["user.email", "t@example.com"], ["commit.gpgsign", "false"]]) git(repo, "config", k, v);
    writeFileSync(join(repo, "README.md"), "notes\n");
    git(repo, "add", "README.md");
    git(repo, "commit", "-qm", "init");
    git(repo, "push", "-q", "origin", "main");
    const dir = join(repo, "journal");
    mkdirSync(join(dir, "2026", "10"), { recursive: true });
    return { remote, repo, dir };
};

describe("syncJournal", () => {
    test("commits the journal folder only and pushes it", async () => {
        const { remote, repo, dir } = setup();
        writeFileSync(join(dir, "2026", "10", "2026-10-28.md"), "# day\n");
        writeFileSync(join(repo, "README.md"), "notes, edited\n");
        writeFileSync(join(repo, "idea.md"), "a note\n");
        git(repo, "add", "idea.md");

        expect(await syncJournal(dir, new Date(2026, 9, 28))).toBe("pushed");

        expect(git(remote, "log", "-1", "--format=%s")).toBe("Journal 2026-10-28");
        expect(git(remote, "show", "--name-only", "--format=", "HEAD")).toBe("journal/2026/10/2026-10-28.md");
        expect(git(repo, "status", "--short")).toBe("M README.md\nA  idea.md");
    });

    test("nothing changed in the journal: no commit", async () => {
        const { remote, dir } = setup();
        expect(await syncJournal(dir, new Date())).toBe("unchanged");
        expect(git(remote, "log", "-1", "--format=%s")).toBe("init");
    });

    test("the remote moved on: rebases onto it and pushes", async () => {
        const { remote, repo, dir } = setup();
        const other = join(repo, "..", "other");
        git(repo, "clone", "-q", remote, other);
        for (const [k, v] of [["user.name", "t"], ["user.email", "t@example.com"], ["commit.gpgsign", "false"]]) git(other, "config", k, v);
        writeFileSync(join(other, "voice.md"), "from elsewhere\n");
        git(other, "add", "voice.md");
        git(other, "commit", "-qm", "voice note");
        git(other, "push", "-q");
        writeFileSync(join(dir, "2026", "10", "2026-10-28.md"), "# day\n");

        expect(await syncJournal(dir, new Date(2026, 9, 28))).toBe("pushed");
        expect(git(remote, "log", "--format=%s")).toBe("Journal 2026-10-28\nvoice note\ninit");
    });

    test("a push that can't go through keeps the commit for the next sync", async () => {
        const { repo, dir } = setup();
        git(repo, "remote", "set-url", "origin", join(repo, "..", "gone.git"));
        writeFileSync(join(dir, "2026", "10", "2026-10-28.md"), "# day\n");
        expect(await syncJournal(dir, new Date(2026, 9, 28))).toMatch(/^push failed/);
        expect(git(repo, "log", "-1", "--format=%s")).toBe("Journal 2026-10-28");
    });
});
