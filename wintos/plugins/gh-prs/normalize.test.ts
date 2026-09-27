import { describe, expect, test } from "vitest";
import { normalize, type Node } from "./normalize";

const node = (n: Partial<Node> = {}): Node => ({
    number: 7, title: "Add flag", url: "https://github.com/o/r/pull/7", isDraft: false,
    createdAt: "2026-09-25T09:00:00Z", author: { login: "ana" }, repository: { nameWithOwner: "o/r" },
    headRefName: "DEV-1-flag", reviewDecision: "REVIEW_REQUIRED", mergeable: "MERGEABLE",
    additions: 10, deletions: 2,
    commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
    reviewRequests: { nodes: [{ requestedReviewer: { __typename: "User", login: "me" } }, { requestedReviewer: { __typename: "Bot", login: "copilot" } }] },
    latestReviews: { nodes: [] },
    ...n,
});

describe("normalize", () => {
    test("maps a search node to the PR shape", () =>
        expect(normalize(node(), "me", { requestedMe: true, requestedTeam: false })).toEqual({
            repo: "o/r", number: 7, url: "https://github.com/o/r/pull/7", title: "Add flag", author: "ana",
            isDraft: false, createdAt: "2026-09-25T09:00:00Z", reviewDecision: "REVIEW_REQUIRED", checks: "SUCCESS",
            conflict: false, requestedMe: true, requestedTeam: false, reviewedByMe: false, reviewers: ["me"],
            additions: 10, deletions: 2, branch: "DEV-1-flag",
        }));

    test("GitHub's merge state is carried", () =>
        expect(normalize(node({ mergeStateStatus: "BLOCKED" }), "me", { requestedMe: false, requestedTeam: false }).mergeState).toBe("BLOCKED"));

    test("bots never count as reviewers or review activity", () => {
        const p = normalize(node({
            reviewRequests: { nodes: [{ requestedReviewer: { __typename: "User", login: "copilot-pull-request-reviewer[bot]" } }] },
            latestReviews: { nodes: [{ author: { login: "github-actions[bot]" }, state: "COMMENTED", submittedAt: "2026-09-26T00:00:00Z" }] },
        }), "me", { requestedMe: false, requestedTeam: false });
        expect([p.reviewers, p.lastReviewAt]).toEqual([[], undefined]);
    });

    test("reviews give the last activity, who asked for changes, and whether I reviewed", () => {
        const p = normalize(node({
            reviewDecision: "CHANGES_REQUESTED",
            latestReviews: { nodes: [
                { author: { login: "me" }, state: "COMMENTED", submittedAt: "2026-09-26T08:00:00Z" },
                { author: { login: "bo.k" }, state: "CHANGES_REQUESTED", submittedAt: "2026-09-26T10:00:00Z" },
            ] },
        }), "me", { requestedMe: false, requestedTeam: false });
        expect([p.lastReviewAt, p.changesRequestedBy, p.reviewedByMe]).toEqual(["2026-09-26T10:00:00Z", "bo.k", true]);
    });

    test("team review requests use the team name; conflicts and missing checks are read", () => {
        const p = normalize(node({
            mergeable: "CONFLICTING", commits: { nodes: [] },
            reviewRequests: { nodes: [{ requestedReviewer: { __typename: "Team", name: "team-core" } }] },
        }), "me", { requestedMe: false, requestedTeam: true });
        expect([p.reviewers, p.conflict, p.checks]).toEqual([["team-core"], true, undefined]);
    });
});
