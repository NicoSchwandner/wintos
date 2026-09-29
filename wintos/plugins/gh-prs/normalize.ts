import type { PR } from "../../daemon/prs/group";

type Reviewer = { __typename: string; login?: string; name?: string };
export type Node = {
    number: number;
    title: string;
    url: string;
    isDraft: boolean;
    createdAt: string;
    author: { login: string } | null;
    repository: { nameWithOwner: string; defaultBranchRef?: { name: string } | null };
    headRefName: string;
    baseRefName?: string;
    reviewDecision: PR["reviewDecision"] | null;
    mergeable: string;
    mergeStateStatus?: string;
    additions: number;
    deletions: number;
    commits: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] };
    reviewRequests: { nodes: { requestedReviewer: Reviewer | null }[] };
    latestReviews: { nodes: { author: { login: string } | null; state: string; submittedAt: string }[] };
};

// Copilot and CI bots request and leave reviews too; counting them hid PRs nobody had looked at.
const isBot = (login = "") => /\[bot\]$/i.test(login) || /copilot/i.test(login);

export function normalize(n: Node, me: string, asked: { requestedMe: boolean; requestedTeam: boolean }): PR {
    const reviews = n.latestReviews.nodes.filter((r) => r.author && !isBot(r.author.login));
    const reviewers = n.reviewRequests.nodes
        .map((r) => r.requestedReviewer)
        .filter((r): r is Reviewer => !!r && r.__typename !== "Bot")
        .map((r) => r.login ?? r.name ?? "")
        .filter((l) => l && !isBot(l));
    const latest = reviews.map((r) => r.submittedAt).sort().pop();
    const checks = n.commits.nodes[0]?.commit.statusCheckRollup?.state;
    const pr: PR = {
        repo: n.repository.nameWithOwner,
        number: n.number,
        url: n.url,
        title: n.title,
        author: n.author?.login ?? "ghost",
        isDraft: n.isDraft,
        createdAt: n.createdAt,
        conflict: n.mergeable === "CONFLICTING",
        requestedMe: asked.requestedMe,
        requestedTeam: asked.requestedTeam,
        reviewedByMe: reviews.some((r) => r.author!.login === me),
        reviewers,
        additions: n.additions,
        deletions: n.deletions,
        branch: n.headRefName,
    };
    if (n.baseRefName) pr.base = n.baseRefName;
    if (n.repository.defaultBranchRef?.name) pr.defaultBranch = n.repository.defaultBranchRef.name;
    if (n.reviewDecision) pr.reviewDecision = n.reviewDecision;
    if (checks) pr.checks = checks;
    if (n.mergeStateStatus) pr.mergeState = n.mergeStateStatus;
    if (latest) pr.lastReviewAt = latest;
    const changes = reviews.filter((r) => r.state === "CHANGES_REQUESTED").pop();
    if (changes) pr.changesRequestedBy = changes.author!.login;
    const approvers = reviews.filter((r) => r.state === "APPROVED").map((r) => r.author!.login);
    if (approvers.length) pr.approvedBy = approvers;
    // A repo that requires no reviews gets no decision from GitHub, approved or not; there a
    // person's approval with nobody asking for changes is the decision.
    if (!n.reviewDecision && approvers.length && !changes) pr.reviewDecision = "APPROVED";
    return pr;
}

// WINTOS_GH_ORGS="acme,globex" limits every search to those orgs (GitHub ORs org: terms).
export function orgQualifier(orgs: string | undefined): string {
    return (orgs ?? "").split(",").map((o) => o.trim()).filter(Boolean).map((o) => `org:${o}`).join(" ");
}

// A PR whose base is another listed PR's branch (same repo) is stacked on that PR.
export function linkStacks(prs: PR[]): PR[] {
    const byHead = new Map(prs.map((p) => [`${p.repo}:${p.branch}`, p.url]));
    return prs.map((p) => {
        const on = p.base && byHead.get(`${p.repo}:${p.base}`);
        return on && on !== p.url ? { ...p, stackedOn: on } : p;
    });
}
