import { describe, expect, test } from "vitest";
import { ageLabel, groupOf, PR, projectPrs, prsForProject, qualifier, workingDaysBetween } from "./group";

// Monday 2026-09-28 09:00 UTC
const MON = Date.parse("2026-09-28T09:00:00Z");
const pr = (p: Partial<PR> = {}): PR => ({
    repo: "acme/api", number: 1, url: "u", title: "t", author: "me", isDraft: false,
    createdAt: "2026-09-25T09:00:00Z", conflict: false, requestedMe: false, requestedTeam: false,
    reviewedByMe: false, reviewers: [], additions: 1, deletions: 1, branch: "b", ...p,
});

describe("workingDaysBetween", () => {
    test("Friday to Monday is one working day", () => expect(workingDaysBetween("2026-09-25T09:00:00Z", MON)).toBe(1));
    test("same day is zero", () => expect(workingDaysBetween("2026-09-28T08:00:00Z", MON)).toBe(0));
    test("Monday a week earlier is five", () => expect(workingDaysBetween("2026-09-21T09:00:00Z", MON)).toBe(5));
});

describe("groupOf (spec §4, first match wins)", () => {
    test("merge: mine, approved, green, not a draft", () =>
        expect(groupOf(pr({ reviewDecision: "APPROVED", checks: "SUCCESS" }), "me", MON)).toBe("merge"));
    test("a conflict keeps an approved PR out of merge and in fix", () =>
        expect(groupOf(pr({ reviewDecision: "APPROVED", checks: "SUCCESS", conflict: true }), "me", MON)).toBe("fix"));
    test("GitHub blocking the merge (code owners still owed) keeps it out of merge", () =>
        expect(groupOf(pr({ reviewDecision: "APPROVED", checks: "SUCCESS", mergeState: "BLOCKED" }), "me", MON)).not.toBe("merge"));
    test("red CI on a draft is work in progress, not a fix", () =>
        expect(groupOf(pr({ isDraft: true, checks: "FAILURE" }), "me", MON)).toBe("team"));
    test("fix: changes requested", () => expect(groupOf(pr({ reviewDecision: "CHANGES_REQUESTED" }), "me", MON)).toBe("fix"));
    test("fix: CI red", () => expect(groupOf(pr({ checks: "FAILURE" }), "me", MON)).toBe("fix"));
    test("fix beats chase", () =>
        expect(groupOf(pr({ checks: "FAILURE", createdAt: "2026-09-01T00:00:00Z" }), "me", MON)).toBe("fix"));
    test("review: someone asked me and I haven't reviewed", () =>
        expect(groupOf(pr({ author: "ana", requestedMe: true }), "me", MON)).toBe("review"));
    test("once I've reviewed it, it's the team's", () =>
        expect(groupOf(pr({ author: "ana", requestedMe: true, reviewedByMe: true }), "me", MON)).toBe("team"));
    test("chase: mine, quiet for two working days", () =>
        expect(groupOf(pr({ createdAt: "2026-09-24T09:00:00Z" }), "me", MON)).toBe("chase"));
    test("review activity resets the clock", () =>
        expect(groupOf(pr({ createdAt: "2026-09-01T09:00:00Z", lastReviewAt: "2026-09-28T08:00:00Z" }), "me", MON)).toBe("team"));
    test("a draft gets five working days before chase", () => {
        expect(groupOf(pr({ isDraft: true, createdAt: "2026-09-23T09:00:00Z" }), "me", MON)).toBe("team");
        expect(groupOf(pr({ isDraft: true, createdAt: "2026-09-21T09:00:00Z" }), "me", MON)).toBe("chase");
    });
    test("others' PRs I'm not asked on are the team's", () => expect(groupOf(pr({ author: "bo.k" }), "me", MON)).toBe("team"));
});

describe("qualifier", () => {
    test("names who asked for changes", () =>
        expect(qualifier(pr({ reviewDecision: "CHANGES_REQUESTED", changesRequestedBy: "ana.b" }), "fix")).toEqual({ text: "changes requested by ana.b" }));
    test("red CI is brick", () => expect(qualifier(pr({ checks: "FAILURE" }), "fix")).toEqual({ text: "CI red", brick: true }));
    test("a chased PR with nobody on it says so", () => expect(qualifier(pr(), "chase")).toEqual({ text: "no reviewer assigned" }));
    test("otherwise it names who it waits on", () => expect(qualifier(pr({ reviewers: ["ana.b"] }), "team")).toEqual({ text: "waiting on ana.b" }));
    test("merge needs no qualifier", () => expect(qualifier(pr(), "merge")).toBeUndefined());
});

describe("ageLabel", () => {
    test("working days, brick past the SLA", () => {
        expect(ageLabel(pr({ createdAt: "2026-09-25T09:00:00Z" }), MON)).toEqual({ text: "1 wd", late: false });
        expect(ageLabel(pr({ createdAt: "2026-09-21T09:00:00Z" }), MON)).toEqual({ text: "5 wd", late: true });
    });
    test("drafts count against their own clock", () => expect(ageLabel(pr({ isDraft: true }), MON)).toEqual({ text: "1 of 5", late: false }));
});

describe("prsForProject", () => {
    const prs = [pr({ repo: "acme/api", number: 101, title: "ABC-42: fix" }), pr({ repo: "acme/billing", number: 7, branch: "ABC-42-x" }), pr({ number: 5, title: "other" })];
    test("declared refs match by short or full repo name and by URL", () => {
        expect(prsForProject(["api#101"], "", prs).map((p) => p.number)).toEqual([101]);
        expect(prsForProject(["acme/api#101"], "", prs).map((p) => p.number)).toEqual([101]);
        expect(prsForProject(["https://github.com/acme/billing/pull/7"], "", prs).map((p) => p.number)).toEqual([7]);
    });
    test("a DEV id in the project title finds PRs by title or branch", () =>
        expect(prsForProject([], "ABC-42 export rejections", prs).map((p) => p.number).sort((a, b) => a - b)).toEqual([7, 101]));
    test("no refs, no id: nothing", () => expect(prsForProject([], "vemsa", prs)).toEqual([]));
});

describe("projectPrs", () => {
    const prs = [
        pr({ number: 1, title: "DEV-9 a", reviewDecision: "CHANGES_REQUESTED", changesRequestedBy: "ana.b" }),
        pr({ number: 2, title: "DEV-9 b", createdAt: "2026-09-21T09:00:00Z" }),
        pr({ number: 3, title: "DEV-9 c", reviewers: ["bo.k"], createdAt: "2026-09-28T08:00:00Z" }),
    ];
    test("groups the project's PRs and blocks on the oldest one that needs you", () => {
        const r = projectPrs({ pr: [], title: "DEV-9" }, prs, "me", MON);
        expect(r.items.map((i) => [i.pr.number, i.group])).toEqual([[1, "fix"], [2, "chase"], [3, "team"]]);
        expect(r.blocked).toEqual({ since: Date.parse("2026-09-21T09:00:00Z"), text: "Nobody has looked at #2 in 5 working days", tone: "brick" });
    });
    test("a fix is yours to do: apricot, naming what happened", () => {
        const r = projectPrs({ pr: [], title: "DEV-9" }, [prs[0]], "me", MON);
        expect(r.blocked).toMatchObject({ text: "#1: changes requested by ana.b", tone: "apricot" });
    });
    test("nothing that needs you: no block, and the quiet reason names the wait", () => {
        const r = projectPrs({ pr: [], title: "DEV-9" }, [prs[2]], "me", MON);
        expect([r.blocked, r.reason]).toEqual([undefined, "#3 with bo.k"]);
    });
    test("an approved PR reads as approved", () =>
        expect(projectPrs({ pr: [], title: "DEV-9" }, [pr({ number: 4, title: "DEV-9", reviewDecision: "APPROVED", checks: "PENDING", createdAt: "2026-09-28T08:00:00Z" })], "me", MON).reason).toBe("#4 approved"));
});
