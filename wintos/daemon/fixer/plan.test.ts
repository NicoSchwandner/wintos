import { describe, expect, test } from "vitest";
import type { PR } from "../prs/group";
import type { Session } from "../sessions/reduce";
import type { Shelf } from "../shelf/shelf";
import { fixJob, conflictJobs, fixKey } from "./plan";

const pr = (n: number, o: Partial<PR> = {}): PR =>
    ({ repo: "o/r", number: n, url: `https://github.com/o/r/pull/${n}`, title: `PR ${n}`, author: "me", isDraft: false, createdAt: "", conflict: false, requestedMe: false, requestedTeam: false, reviewedByMe: false, reviewers: [], additions: 1, deletions: 1, branch: `b${n}`, head: `sha${n}`, ...o }) as PR;
const session = (id: string, state: Session["state"], prs: string[]): Session => ({ id, tabId: "t1", blockId: `blk-${id}`, state, since: 1, lastAt: 1, prs });
const RESUME = (id: string) => `cd '/w' && claude --resume '${id}'`;

describe("conflictJobs (run by themselves)", () => {
    test("each of my open PRs in conflict, once per head commit, as a fresh run", () => {
        const prs = [pr(1, { conflict: true }), pr(2), pr(3, { conflict: true, author: "ana" }), pr(4, { conflict: true, mergedAt: "x" }), pr(5, { conflict: true })];
        const tried = new Set([fixKey("conflict", prs[4])]);
        expect(conflictJobs(prs, "me", tried).map((j) => [j.pr.number, j.kind, j.route.kind])).toEqual([[1, "conflict", "fresh"]]);
    });

    test("a new head commit is a new attempt; one without a known head is skipped", () => {
        const tried = new Set([fixKey("conflict", pr(1, { conflict: true }))]);
        expect(conflictJobs([pr(1, { conflict: true, head: "sha1-b" }), pr(2, { conflict: true, head: undefined })], "me", tried).map((j) => j.pr.head)).toEqual(["sha1-b"]);
    });
});

describe("fixJob (red CI, dispatched)", () => {
    const red = pr(7, { checks: "FAILURE" });

    test("goes to the live session that owns the PR, in its pane", () => {
        expect(fixJob(red, [session("a", "waiting", [red.url])], {}).route).toEqual({ kind: "pane", tabId: "t1", blockId: "blk-a", sessionId: "a" });
    });

    test("a shelved owner is resumed under its own id; an ended session owns nothing", () => {
        const shelf: Shelf = { proj: [{ sessionId: "s", script: RESUME("s"), label: "x", prs: [red.url], at: 1 }] };
        expect(fixJob(red, [session("gone", "ended", [red.url])], shelf).route).toEqual({ kind: "resume", sessionId: "s", script: RESUME("s") });
    });

    test("a live owner wins over a shelved one; with no owner, a fresh run", () => {
        const shelf: Shelf = { proj: [{ sessionId: "s", script: RESUME("s"), label: "x", prs: [red.url], at: 1 }] };
        expect(fixJob(red, [session("a", "idle", [red.url])], shelf).route.kind).toBe("pane");
        expect(fixJob(red, [], {}).route).toEqual({ kind: "fresh" });
    });
});
