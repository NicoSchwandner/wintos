import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, test } from "vitest";
import type { Session } from "../sessions/reduce";
import { ownerOf, resumeOfFound, searchTranscripts } from "./handoff";

const PR = "https://github.com/o/r/pull/1";
const s = (o: Partial<Session>): Session => ({ id: "s1", tabId: "t", blockId: "b", state: "idle", since: 1, lastAt: 1, prs: [PR], cwd: "/w", ...o });

test("routes: a pane, the background, paused in its pane, ended or shelved resumed headless, else none", () => {
    expect(ownerOf(PR, [s({})], {}).route).toBe("pane");
    expect(ownerOf(PR, [s({ bgId: "ab12cd34" })], {}).route).toBe("background");
    expect(ownerOf(PR, [s({ bgId: "ab12cd34", attachedTo: "b" })], {}).route).toBe("pane");
    expect(ownerOf(PR, [s({ restored: true, paused: 1 })], {})).toMatchObject({ route: "paused", script: "cd '/w' && claude --resume 's1'" });
    expect(ownerOf(PR, [s({ state: "ended" })], {})).toMatchObject({ route: "shelved", sessionId: "s1" });
    expect(ownerOf(PR, [], { f: [{ sessionId: "old", script: "cd '/x' && claude --resume 'old'", label: "x", prs: [PR], at: 1 }] })).toMatchObject({ route: "shelved", sessionId: "old" });
    expect(ownerOf(PR, [s({ prs: [] })], {}).route).toBe("none");
});

test("a live owner wins over an ended one that held the PR before", () => {
    expect(ownerOf(PR, [s({ id: "gone", state: "ended" }), s({ id: "now" })], {}).sessionId).toBe("now");
});

describe("searchTranscripts", () => {
    const transcript = (dir: string, project: string, id: string, rows: object[]) => {
        mkdirSync(join(dir, "projects", project), { recursive: true });
        const f = join(dir, "projects", project, `${id}.jsonl`);
        writeFileSync(f, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
        return f;
    };
    const opened = (at: string, cwd: string) => ({ timestamp: at, cwd, type: "user", toolUseResult: { stdout: `PR: ${PR}` } });

    test("the session whose transcript names the PR first, in its directory and account, not a subagent's", async () => {
        const dir = mkdtempSync(join(tmpdir(), "claude-cfg-"));
        const old = Date.now() / 1000 - 3600;
        utimesSync(transcript(dir, "-w", "reviewer", [opened("2026-11-10T10:00:00Z", "/r")]), old, old);
        utimesSync(transcript(dir, "-w", "creator", [{ timestamp: "2026-11-09T08:00:00Z", cwd: "/w" }, opened("2026-11-09T09:00:00Z", "/w/Core")]), old, old);
        transcript(dir, "-w/creator/subagents", "agent-1", [opened("2026-11-01T09:00:00Z", "/w")]);
        const found = await searchTranscripts(PR, [dir]);
        expect(found).toEqual({ sessionId: "creator", cwd: "/w/Core", configDir: dir, running: false });
        expect(resumeOfFound(found!, "/home/n")).toBe(`cd '/w/Core' && CLAUDE_CONFIG_DIR='${dir}' claude --resume 'creator'`);
        expect(resumeOfFound({ ...found!, configDir: "/home/n/.claude" }, "/home/n")).toBe("cd '/w/Core' && claude --resume 'creator'");
    });

    test("one written to in the last minutes may be at work: running", async () => {
        const dir = mkdtempSync(join(tmpdir(), "claude-cfg-"));
        transcript(dir, "-w", "busy", [opened("2026-11-09T09:00:00Z", "/w")]);
        expect((await searchTranscripts(PR, [dir]))?.running).toBe(true);
        expect(await searchTranscripts("https://github.com/o/r/pull/99", [dir])).toBeUndefined();
    });
});
