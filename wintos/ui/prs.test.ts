import { describe, expect, test } from "vitest";
import type { PR } from "../daemon/prs/group";
import { initials, keepSelection, matchesPr, queueModel, reviewerChips, rowColumns } from "./prs";

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

    test("header counts: yours are the four you act on, team is the rest", () => expect([m.yours, m.waiting, m.team]).toEqual([4, 0, 1]));

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

    test("past SLA counts chases and late reviews", () => expect(m.pastSla).toBe(2));

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
