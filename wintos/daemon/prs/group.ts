// The PR queue's rules (spec §4): each PR lands in exactly one group, by the action it asks of you.
export type PR = {
    repo: string; // owner/name
    number: number;
    url: string;
    title: string;
    author: string;
    isDraft: boolean;
    createdAt: string;
    lastReviewAt?: string;
    reviewDecision?: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED";
    checks?: string; // statusCheckRollup state: SUCCESS, FAILURE, ERROR, PENDING, EXPECTED
    conflict: boolean;
    mergeState?: string; // mergeStateStatus: CLEAN, BLOCKED, BEHIND, UNSTABLE, DIRTY, …
    requestedMe: boolean; // asked of me personally
    requestedTeam: boolean; // asked of one of my teams
    reviewedByMe: boolean;
    reviewers: string[]; // people and teams still asked, bots excluded
    changesRequestedBy?: string;
    additions: number;
    deletions: number;
    branch: string;
    base?: string; // the branch it merges into
    defaultBranch?: string; // the repo's
    stackedOn?: string; // url of the open PR whose branch is `base`, when that PR is in the list
};

// On another branch than the repo's default: merging it would land on that branch, not ship.
export const isStacked = (pr: PR) => !!pr.base && !!pr.defaultBranch && pr.base !== pr.defaultBranch;
export type Group = "merge" | "fix" | "review" | "chase" | "team";
export const GROUPS: Group[] = ["merge", "fix", "review", "chase", "team"];

// The team's rule: past two working days a PR comes back to its author. A draft is nobody
// else's problem yet, so it only becomes a decision after a longer silence.
export const SLA_WORKING_DAYS = 2;
export const DRAFT_SLA_WORKING_DAYS = 5;

const DAY = 86_400_000;
const redChecks = (pr: PR) => pr.checks === "FAILURE" || pr.checks === "ERROR";
const sla = (pr: PR) => (pr.isDraft ? DRAFT_SLA_WORKING_DAYS : SLA_WORKING_DAYS);
const lastMovement = (pr: PR) => pr.lastReviewAt ?? pr.createdAt;

// Weekdays elapsed after `from` up to `now`. No holiday calendar (spec §4).
export function workingDaysBetween(from: string, now: number): number {
    const start = new Date(from);
    const d = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
    let n = 0;
    for (let t = d + DAY; t <= now; t += DAY) {
        const wd = new Date(t).getUTCDay();
        if (wd !== 0 && wd !== 6) n++;
    }
    return n;
}

export function groupOf(pr: PR, me: string, now: number): Group {
    const mine = pr.author === me;
    const approved = pr.reviewDecision === "APPROVED";
    // No CI at all is green: a repo without checks must still reach Merge. BLOCKED is GitHub
    // saying no: an approval alone does not satisfy code owners.
    const green = pr.checks === undefined || pr.checks === "SUCCESS";
    if (mine && approved && green && !pr.isDraft && !pr.conflict && pr.mergeState !== "BLOCKED" && !isStacked(pr)) return "merge";
    // Red CI on a draft is work in progress; the draft keeps its own, longer clock.
    if (mine && (pr.reviewDecision === "CHANGES_REQUESTED" || (redChecks(pr) && !pr.isDraft) || pr.conflict)) return "fix";
    // GitHub drops a request when you review, so being asked means a review is owed, re-requests included.
    if (!mine && pr.requestedMe) return "review";
    // An approved PR that can't merge yet is waiting on checks or code owners, not on attention.
    if (mine && !approved && workingDaysBetween(lastMovement(pr), now) >= sla(pr)) return "chase";
    return "team";
}

export function qualifier(pr: PR, group: Group): { text: string; brick?: boolean } | undefined {
    if (group === "merge") return undefined;
    if (group === "fix") {
        if (pr.reviewDecision === "CHANGES_REQUESTED") return { text: pr.changesRequestedBy ? `changes requested by ${pr.changesRequestedBy}` : "changes requested" };
        if (redChecks(pr)) return { text: "CI red", brick: true };
        if (pr.conflict) return { text: "merge conflict", brick: true };
    }
    if (pr.reviewDecision === "APPROVED" && pr.mergeState === "BLOCKED") return { text: "approved · blocked by required reviews" };
    if (pr.reviewDecision === "APPROVED" && (pr.checks === "PENDING" || pr.checks === "EXPECTED")) return { text: "approved · checks pending" };
    if (group === "chase" && !pr.isDraft && pr.reviewers.length === 0) return { text: "no reviewer assigned" };
    if (pr.reviewers.length) return { text: `waiting on ${pr.reviewers.join(", ")}` };
    return undefined;
}

export function ageLabel(pr: PR, now: number): { text: string; late: boolean } {
    const wd = workingDaysBetween(lastMovement(pr), now);
    return { text: pr.isDraft ? `${wd} of ${DRAFT_SLA_WORKING_DAYS}` : `${wd} wd`, late: wd >= sla(pr) };
}

// A project's PRs: the refs Claude recorded in project.md (repo#n, owner/repo#n, or a URL),
// plus any PR whose title or branch carries the ticket id (ABC-123) from the project title.
export function prsForProject(refs: string[], title: string, prs: PR[]): PR[] {
    const wanted = refs.map(parseRef).filter((r): r is { repo: string; number: number } => !!r);
    const ticket = /\b[A-Z][A-Z0-9]+-\d+\b/.exec(title)?.[0];
    // Whole-id match: ABC-12 must not pick up ABC-123; branches are often lowercase.
    const hasTicket = ticket ? (s: string) => new RegExp(`\\b${ticket}(?!\\d)`, "i").test(s) : () => false;
    return prs.filter(
        (p) =>
            wanted.some((w) => w.number === p.number && (w.repo === p.repo || w.repo === p.repo.split("/")[1])) ||
            hasTicket(p.title) ||
            hasTicket(p.branch)
    );
}

function parseRef(ref: string): { repo: string; number: number } | undefined {
    const url = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(ref);
    if (url) return { repo: url[1], number: Number(url[2]) };
    const short = /^([\w.-]+(?:\/[\w.-]+)?)#(\d+)$/.exec(ref.trim());
    return short ? { repo: short[1], number: Number(short[2]) } : undefined;
}

export type ProjectPrs = {
    items: { pr: PR; group: Group }[];
    blocked?: { since: number; text: string; tone: "apricot" | "brick" };
    reason?: string; // the quiet row's right column
};

// What a project's PRs mean for its sidebar row: whether one needs you (spec §3.3, Fix or
// Chase), and otherwise why the project is quiet.
export function projectPrs(project: { pr?: string[]; title?: string }, prs: PR[], me: string, now: number): ProjectPrs {
    const items = prsForProject(project.pr ?? [], project.title ?? "", prs).map((pr) => ({ pr, group: groupOf(pr, me, now) }));
    const needing = items.filter((i) => i.group === "fix" || i.group === "chase");
    const oldest = needing.sort((a, b) => Date.parse(lastMovement(a.pr)) - Date.parse(lastMovement(b.pr)))[0];
    if (oldest) {
        const { pr, group } = oldest;
        const since = Date.parse(lastMovement(pr));
        if (group === "fix") return { items, blocked: { since, text: `#${pr.number}: ${qualifier(pr, group)?.text ?? "needs a fix"}`, tone: "apricot" } };
        const wd = workingDaysBetween(lastMovement(pr), now);
        return { items, blocked: { since, text: `Nobody has looked at #${pr.number} in ${wd} working days`, tone: "brick" } };
    }
    const first = items[0]?.pr;
    if (!first) return { items };
    const reason = first.reviewDecision === "APPROVED" ? "approved" : first.reviewers.length ? `with ${first.reviewers[0]}` : first.isDraft ? "draft" : "open";
    return { items, reason: `#${first.number} ${reason}` };
}
