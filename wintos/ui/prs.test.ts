import { describe, expect, test } from "vitest";
import type { PR } from "../daemon/prs/group";
import { initials, queueModel } from "./prs";

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

    test("header counts: yours are the four you act on, team is the rest", () => expect([m.yours, m.team]).toEqual([4, 1]));

    test("past SLA counts chases and late reviews", () => expect(m.pastSla).toBe(2));

    test("empty groups are dropped", () => expect(queueModel([pr({ reviewDecision: "APPROVED", checks: "SUCCESS" })], "me", MON).groups.map((g) => g.group)).toEqual(["merge"]));

    test("a row carries the diff total and the short repo name", () =>
        expect(m.groups[0].rows[0]).toMatchObject({ total: 4, repoShort: "api", mine: true }));
});

describe("initials", () => {
    test.each([["ana.b", "AB"], ["JaneDoe", "JD"], ["p-ek", "PE"], ["x", "X"]])("%s → %s", (login, out) => expect(initials(login)).toBe(out));
});
