import { describe, expect, test } from "vitest";
import type { PR } from "../daemon/prs/group";
import type { FixRun } from "../daemon/fixer/runner";
import { fixNote, initials, standupAsks, keepSelection, matchesPr, queueModel, reviewerChips, rowColumns } from "./prs";

const MON = Date.parse("2026-09-28T09:00:00Z");
const pr = (p: Partial<PR>): PR => ({
    repo: "acme/api", number: 1, url: "u", title: "t", author: "me", isDraft: false, createdAt: "2026-09-28T08:00:00Z",
    conflict: false, requestedMe: false, requestedTeam: false, reviewedByMe: false, reviewers: [], additions: 3, deletions: 1, branch: "b", ...p,
});

describe("queueModel", () => {
    const prs = [
        pr({ number: 1, reviewDecision: "APPROVED", checks: "SUCCESS" }),
        pr({ number: 2, checks: "FAILURE" }),
        pr({ number: 3, author: "ana", requestedMe: true, createdAt: "2026-09-21T09:00:00Z" }),
        pr({ number: 4, createdAt: "2026-09-21T09:00:00Z" }),
        pr({ number: 5, author: "bo.k", requestedTeam: true }),
    ];
    const m = queueModel(prs, "me", MON);

    test("groups in the spec's order, each PR once", () =>
        expect(m.groups.map((g) => [g.group, g.rows.map((r) => r.pr.number)])).toEqual([
            ["merge", [1]], ["fix", [2]], ["review", [3]], ["chase", [4]], ["team", [5]],
        ]));

    test("header counts: yours are the three in your court (the chase waits on others), team is the rest", () => expect([m.yours, m.waiting, m.team]).toEqual([3, 0, 1]));

    test("someone else's draft asked of your team is not shown: it asks nothing yet", () => {
        const d = queueModel([pr({ number: 7, author: "bo.k", requestedTeam: true, isDraft: true })], "me", MON);
        expect([d.groups, d.team]).toEqual([[], 0]);
    });

    test("your PRs waiting on others count as waiting, not yours", () => {
        const w = queueModel([pr({ number: 6, reviewers: ["ana"] })], "me", MON);
        expect([w.groups.map((g) => g.group), w.yours, w.waiting]).toEqual([["waiting"], 0, 1]);
    });

    test("a stacked PR names a snoozed base by its number", () => {
        const base = pr({ number: 20, url: "u20", branch: "a", base: "main", defaultBranch: "main", reviewDecision: "APPROVED", checks: "SUCCESS" });
        const top = pr({ number: 21, url: "u21", branch: "b", base: "a", defaultBranch: "main", stackedOn: "u20", checks: "FAILURE" });
        const w = queueModel([base, top], "me", MON, { u20: { until: MON + 1, movedAt: base.createdAt } });
        expect(w.groups[0].rows[0].qualifier?.text).toBe("CI red · stacked on #20");
    });

    test("past SLA is what you are late on: a late review counts, a chase (someone owes you) does not", () => expect(m.pastSla).toBe(1));
    test("the team's review requests past the SLA have their own count", () => {
        const t = queueModel([pr({ number: 5, author: "bo.k", requestedTeam: true, createdAt: "2026-09-21T09:00:00Z" }), pr({ number: 6, author: "bo.k", requestedTeam: true })], "me", MON);
        expect([t.team, t.teamPastSla]).toEqual([2, 1]);
    });
    test("the rows behind the past-SLA counts carry the mark, the rest don't", () => {
        const t = queueModel([pr({ number: 5, url: "t", author: "bo.k", requestedTeam: true, createdAt: "2026-09-21T09:00:00Z" }), ...prs], "me", MON);
        const marks = t.groups.flatMap((g) => g.rows.map((r) => [r.pr.number, r.sla]));
        expect(marks).toEqual([[1, undefined], [2, undefined], [3, "yours"], [4, undefined], [5, "team"], [5, undefined]]);
    });
    test("a draft of yours past its clock counts past SLA too", () =>
        expect(queueModel([pr({ number: 9, isDraft: true, createdAt: "2026-09-14T09:00:00Z" })], "me", MON).pastSla).toBe(1));

    test("empty groups are dropped", () => expect(queueModel([pr({ reviewDecision: "APPROVED", checks: "SUCCESS" })], "me", MON).groups.map((g) => g.group)).toEqual(["merge"]));

    test("a row carries the diff total and the short repo name", () =>
        expect(m.groups[0].rows[0]).toMatchObject({ total: 4, repoShort: "api", mine: true }));
});

describe("initials", () => {
    test.each([["ana.b", "AB"], ["JaneDoe", "JD"], ["p-ek", "PE"], ["x", "X"]])("%s → %s", (login, out) => expect(initials(login)).toBe(out));
});

describe("queueModel with a stack (#101 on development ← #102 ← #103)", () => {
    const stack = (p101: Partial<PR>, p102: Partial<PR>, p103: Partial<PR>) => [
        pr({ number: 101, url: "u101", branch: "a", base: "development", defaultBranch: "development", ...p101 }),
        pr({ number: 102, url: "u102", branch: "b", base: "a", defaultBranch: "development", stackedOn: "u101", reviewDecision: "APPROVED", checks: "SUCCESS", ...p102 }),
        pr({ number: 103, url: "u103", branch: "c", base: "b", defaultBranch: "development", stackedOn: "u102", reviewDecision: "APPROVED", checks: "SUCCESS", ...p103 }),
    ];
    const shape = (m: ReturnType<typeof queueModel>) =>
        m.groups.map((g) => [g.group, g.rows.map(function tree(r): unknown { return r.children.length ? [r.pr.number, r.children.map(tree)] : r.pr.number; })]);

    test("the base needs a fix: the waiting PRs sit under it, one level per step", () => {
        const m = queueModel(stack({ checks: "FAILURE" }, {}, {}), "me", MON);
        expect(shape(m)).toEqual([["fix", [[101, [[102, [103]]]]]]]);
        expect(m.groups[0].rows[0].children[0].qualifier?.text).toBe("merges after #101");
    });

    test("the tail needs a fix: it gets its own row in Fix, noting its base", () => {
        const m = queueModel(stack({ reviewDecision: "APPROVED", checks: "SUCCESS" }, {}, { reviewDecision: "CHANGES_REQUESTED" }), "me", MON);
        expect(shape(m)).toEqual([["merge", [[101, [102]]]], ["fix", [103]]]);
        expect(m.groups[1].rows[0].qualifier?.text).toBe("changes requested · stacked on #102");
    });

    test("a base PR outside the list: the stacked PR stays a row, never in Merge", () => {
        const m = queueModel([pr({ number: 7, base: "someone-else", defaultBranch: "development", reviewDecision: "APPROVED", checks: "SUCCESS" })], "me", MON);
        expect(m.groups.map((g) => g.group)).not.toContain("merge");
        expect(m.groups[0].rows[0].qualifier?.text).toBe("stacked on someone-else");
    });
});

describe("queueModel with snoozes", () => {
    const fix = pr({ number: 9, url: "u9", checks: "FAILURE", createdAt: "2026-09-28T08:00:00Z" });

    test("a snoozed PR leaves its group and the counts, and waits at the bottom", () => {
        const m = queueModel([fix], "me", MON, { u9: { until: MON + 1, movedAt: "2026-09-28T08:00:00Z" } });
        expect(m.groups).toEqual([]);
        expect(m.snoozed.map((r) => r.pr.number)).toEqual([9]);
        expect(m.yours).toBe(0);
    });

    test("it is back once the PR moved", () => {
        const m = queueModel([{ ...fix, lastReviewAt: "2026-09-28T08:30:00Z" }], "me", MON, { u9: { until: MON + 1, movedAt: "2026-09-28T08:00:00Z" } });
        expect(m.groups.map((g) => g.group)).toEqual(["fix"]);
        expect(m.snoozed).toEqual([]);
    });
});

describe("queueModel order", () => {
    test("within a group the longest-waiting PR comes first, not just late before on time", () => {
        const m = queueModel(
            [
                pr({ number: 1, author: "ana", createdAt: "2026-09-27T09:00:00Z" }),
                pr({ number: 2, author: "ana", createdAt: "2026-09-20T09:00:00Z" }),
                pr({ number: 3, author: "ana", createdAt: "2026-09-25T09:00:00Z" }),
            ],
            "me",
            MON
        );
        expect(m.groups[0].rows.map((r) => r.pr.number)).toEqual([2, 3, 1]);
    });
});

describe("group order", () => {
    test("the team's reviews (undone work) come before your PRs that are just waiting", () => {
        const m = queueModel([pr({ number: 1, reviewers: ["ana"] }), pr({ number: 2, author: "bo", requestedTeam: true })], "me", MON);
        expect(m.groups.map((g) => g.group)).toEqual(["team", "waiting"]);
    });
});

describe("keepSelection", () => {
    test("the selected PR stays selected wherever it moves", () => expect(keepSelection(["a", "b", "c"], ["x", "a", "b", "c"], "b")).toBe("b"));

    test("gone, the selection moves to the next PR that was below it", () => expect(keepSelection(["a", "b", "c", "d"], ["a", "d"], "b")).toBe("d"));

    test("gone from the bottom, to the one above it", () => expect(keepSelection(["a", "b", "c"], ["a", "b"], "c")).toBe("b"));

    test("nothing selected yet or an empty list", () => {
        expect(keepSelection([], ["a"], undefined)).toBe("a");
        expect(keepSelection(["a"], [], "a")).toBeUndefined();
    });
});

describe("reviewerChips", () => {
    test("up to two, then how many more", () => expect(reviewerChips(pr({ reviewers: ["ana", "bo", "team-x"] }), 2)).toEqual({ chips: ["ana", "bo"], more: 1, none: false, approved: [] }));

    test("with nobody still asked, whoever approved shows instead of none", () =>
        expect(reviewerChips(pr({ reviewers: [], approvedBy: ["genne"] }), 2)).toEqual({ chips: [], more: 0, none: false, approved: ["genne"] }));
    test("nobody asked on a ready PR is a 'none' chip; on a draft it is nothing", () => {
        expect(reviewerChips(pr({ reviewers: [] }), 2)).toEqual({ chips: [], more: 0, none: true, approved: [] });
        expect(reviewerChips(pr({ reviewers: [], isDraft: true }), 2)).toEqual({ chips: [], more: 0, none: false, approved: [] });
    });
    test("changes requested: nobody is asked because the ball is with the author, so no 'none'", () =>
        expect(reviewerChips(pr({ reviewers: [], changesRequestedBy: "tobi" }), 2).none).toBe(false));
});

describe("rowColumns", () => {
    test("the list alone or a wide split shows every column", () => expect(rowColumns(1400)).toEqual({ size: true, names: true }));
    test("a little narrower, the size bar goes first", () => expect(rowColumns(900)).toEqual({ size: false, names: true }));
    test("beside a page on a laptop, names become initials too", () => expect(rowColumns(500)).toEqual({ size: false, names: false }));
});

describe("matchesPr", () => {
    const p = { repo: "acme/api", number: 1479, title: "Fix the rounding", author: "ana.b", branch: "ABC-12-rounding" } as Parameters<typeof matchesPr>[0];
    test.each([
        ["", true],
        ["rounding", true],
        ["ROUND acme", true],
        ["1479", true],
        ["#1479", true],
        ["ana", true],
        ["abc-12", true],
        ["rounding vat", false],
    ])("%s → %s", (q, out) => expect(matchesPr(p, q)).toBe(out));
});

test("an unreleased merge past the SLA is in Release, counted past SLA", () => {
    const m = queueModel([pr({ url: "r", mergedAt: "2026-09-23T09:00:00Z" })], "me", MON);
    expect(m.groups.map((g) => g.group)).toEqual(["release"]);
    expect(m.pastSla).toBe(1);
});

test("a merged PR asks no reviewer", () => expect(reviewerChips(pr({ mergedAt: "2026-09-23T09:00:00Z" }), 2).none).toBe(false));

describe("fixNote", () => {
    const pr = { url: "u", head: "h1" } as PR;
    const run = (o: Partial<FixRun> = {}): FixRun => ({ id: "r", kind: "conflict", url: "u", head: "h1", route: "fresh", at: 1, ...o });
    test("says what the fixer does about the PR's current commit only", () => {
        expect(fixNote(run({ head: "h0" }), pr, [])).toBeUndefined();
        expect(fixNote(undefined, pr, [])).toBeUndefined();
        expect(fixNote(run(), pr, ["r"])).toEqual({ text: "fixing the conflict next" });
        expect(fixNote(run({ startedAt: 2 }), pr, [])).toEqual({ text: "fixing the conflict…" });
        expect(fixNote(run(), pr, [])).toEqual({ text: "fixing the conflict next" });
        expect(fixNote(run({ kind: "ci", route: "pane" }), pr, [])).toEqual({ text: "red CI sent to its session" });
        expect(fixNote(run({ endedAt: 2, exit: 0, result: "Pushed." }), pr, [])).toEqual({ text: "tried to fix the conflict: Pushed." });
        expect(fixNote(run({ endedAt: 2, exit: 1 }), pr, [])).toEqual({ text: "fixing the conflict failed", brick: true });
    });
});

describe("standupAsks", () => {
    const NOW = Date.parse("2026-10-19T09:00:00Z"); // a Monday
    const pr = (n: number, o: Partial<PR> = {}): PR => ({ repo: "o/r", number: n, url: `u${n}`, title: `PR ${n}`, author: "me", isDraft: false, createdAt: "2026-10-14T09:00:00Z", conflict: false, requestedMe: false, requestedTeam: false, reviewedByMe: false, reviewers: ["team-x"], additions: 1, deletions: 1, branch: "b", ...o }) as PR;
    test("a few by name; drafts, approved, merged, others' and fresh ones are no ask", () => {
        const prs = [pr(1), pr(2, { isDraft: true }), pr(3, { reviewDecision: "APPROVED" }), pr(4, { mergedAt: "x" }), pr(5, { author: "ana" }), pr(6, { createdAt: "2026-10-19T08:00:00Z" }), pr(7, { reviewers: [] })];
        expect(standupAsks(prs, "me", NOW)).toBe("#1 PR 1 waits for a review from team-x");
    });
    test("more than two: counts per reviewer, most first", () => {
        expect(standupAsks([pr(1), pr(2), pr(3, { reviewers: ["team-ai"] })], "me", NOW)).toBe("3 PRs wait for a review: 2 on team-x, 1 on team-ai");
        expect(standupAsks([], "me", NOW)).toBeUndefined();
    });
    test("with your team known: how many wait within it, a teammate named only from three on, others' teams counted in the total only", () => {
        const team = ["team-x", "ana", "bo"];
        const prs = [pr(1), pr(2, { reviewers: ["ana"] }), pr(3, { reviewers: ["ana"] }), pr(4, { reviewers: ["ana", "zed"] }), pr(5, { reviewers: ["bo"] }), pr(6, { reviewers: ["team-ai"] })];
        expect(standupAsks(prs, "me", NOW, team)).toBe("6 PRs wait for a review, 5 within the team: 3 on ana");
        expect(standupAsks([pr(1), pr(6, { reviewers: ["team-ai"] })], "me", NOW, team)).toBe("2 PRs wait for a review, 1 within the team");
        expect(standupAsks([pr(6, { reviewers: ["team-ai"] })], "me", NOW, team)).toBeUndefined();
    });
});
