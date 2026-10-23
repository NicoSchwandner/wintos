import type { FixRun } from "../daemon/fixer/runner";
import { ageLabel, byUrgency, Group, GROUPS, groupOf, isSnoozed, isStacked, lastMovement, PR, qualifier, workingDaysBetween, type Snoozes } from "../daemon/prs/group";

// children: PRs stacked on this one that only wait for it (spec: stacked PRs sit under their base).
// counts: the PRs card number this row is in, yours or the team's; sla: it is also counted past SLA.
export type QueueRow = { pr: PR; group: Group; mine: boolean; age: { text: string; late: boolean }; qualifier?: { text: string; brick?: boolean }; total: number; children: QueueRow[]; counts?: "yours" | "team"; sla?: "yours" | "team" };

const ACTS: Group[] = ["merge", "fix", "review", "chase"];

// Longest untouched first: the older the last review or push, the more it is owed.
// snoozed: looked at and handed on; out of the groups and the counts until it wakes.
// yours: what is in your court (Chase waits on others); teamPastSla: your team's review requests
// nobody took up in time.
export type QueueModel = { groups: { group: Group; rows: QueueRow[] }[]; snoozed: QueueRow[]; yours: number; waiting: number; team: number; pastSla: number; teamPastSla: number };

export function queueModel(prs: PR[], me: string, now: number, snoozes: Snoozes = {}): QueueModel {
    const toRow = (pr: PR): QueueRow => {
        const group = groupOf(pr, me, now);
        return { pr, group, mine: pr.author === me, age: ageLabel(pr, now), qualifier: qualifier(pr, group, { reviewers: false }), total: pr.additions + pr.deletions, children: [] };
    };
    const snoozed = prs.filter((p) => isSnoozed(p, snoozes, now)).map(toRow);
    // Someone else's draft asks nothing of your team yet, whoever is requested on it.
    const all = prs.filter((p) => !isSnoozed(p, snoozes, now)).map(toRow).filter((r) => !(r.group === "team" && r.pr.isDraft));
    const byUrl = new Map(all.map((r) => [r.pr.url, r]));
    const numbers = new Map(prs.map((p) => [p.url, p.number])); // snoozed bases too
    // A stacked PR that asks nothing of you waits under its base; one that does keeps its own
    // row, where you act, and names its base.
    const nested = new Set<QueueRow>();
    for (const r of all) {
        if (!isStacked(r.pr)) continue;
        const base = r.pr.stackedOn ? byUrl.get(r.pr.stackedOn) : undefined;
        const on = r.pr.stackedOn && numbers.has(r.pr.stackedOn) ? `#${numbers.get(r.pr.stackedOn)}` : r.pr.base!;
        if (base && !ACTS.includes(r.group)) {
            r.qualifier = { text: `merges after ${on}` };
            base.children.push(r);
            nested.add(r);
        } else r.qualifier = { text: r.qualifier ? `${r.qualifier.text} · stacked on ${on}` : `stacked on ${on}`, brick: r.qualifier?.brick };
    }
    const rows = all.filter((r) => !nested.has(r));
    // What you are late on: a review you owe, a release of your merged work, a draft of yours past
    // its clock. Chase is not: there someone owes you the review.
    for (const r of rows) {
        if (r.group === "team") r.counts = "team";
        else if (r.group !== "waiting" && r.group !== "chase") r.counts = "yours";
        if (r.group === "team" && r.age.late) r.sla = "team";
        else if (r.group === "release" || (r.group === "review" && r.age.late) || (r.group === "fix" && r.pr.isDraft && r.age.late)) r.sla = "yours";
    }
    const groups = GROUPS.map((group) => ({ group, rows: rows.filter((r) => r.group === group).sort(byUrgency) })).filter((g) => g.rows.length);
    const team = rows.filter((r) => r.counts === "team").length;
    const waiting = rows.filter((r) => r.group === "waiting").length;
    return {
        groups,
        snoozed,
        yours: rows.filter((r) => r.counts === "yours").length,
        waiting,
        team,
        teamPastSla: rows.filter((r) => r.sla === "team").length,
        pastSla: rows.filter((r) => r.sla === "yours").length,
    };
}

export function initials(login: string): string {
    const parts = login.split(/[.\-_]/).filter(Boolean);
    if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
    const caps = login.match(/[A-Z]/g);
    if (caps && caps.length > 1) return caps.slice(0, 2).join("");
    return login.slice(0, 1).toUpperCase();
}

// The PR queue's cursor follows a PR, not a row number: the list reorders as PRs change group.
// A PR that left the list hands the cursor to the next one that was below it, else above.
export function keepSelection(before: string[], after: string[], selected: string | undefined): string | undefined {
    if (selected && after.includes(selected)) return selected;
    const i = selected ? before.indexOf(selected) : -1;
    const below = before.slice(i + 1).find((u) => after.includes(u));
    const above = before.slice(0, Math.max(i, 0)).reverse().find((u) => after.includes(u));
    return (i >= 0 && (below ?? above)) || after[0];
}

// Who a PR waits on, as chips beside it (a wrapped "waiting on a, b, team" line was unreadable).
// A ready PR nobody is asked on shows "none"; a draft is nobody's yet, a merged one nobody's any
// more, and one with changes requested is its author's (the reviewer leaves the requested list).
// With nobody still asked, whoever approved is shown (✓) instead.
export function reviewerChips(pr: PR, max: number): { chips: string[]; more: number; none: boolean; approved: string[] } {
    const approved = pr.reviewers.length ? [] : (pr.approvedBy ?? []).slice(0, max);
    return { chips: pr.reviewers.slice(0, max), more: Math.max(0, pr.reviewers.length - max), none: !pr.isDraft && !pr.mergedAt && !pr.changesRequestedBy && pr.reviewers.length === 0 && !approved.length, approved };
}

// Which optional columns fit beside a readable title: the size bar goes first, then the names
// (the author's, and reviewers' in full rather than initials).
export type RowColumns = { size: boolean; names: boolean };
export const rowColumns = (width: number): RowColumns => ({ size: width >= 1000, names: width >= 850 });

// The PR list's filter (f): every word of the query appears in the PR's repo, number, title,
// author or branch.
export function matchesPr(pr: Pick<PR, "repo" | "number" | "title" | "author" | "branch">, query: string): boolean {
    const hay = `${pr.repo} #${pr.number} ${pr.title} ${pr.author} ${pr.branch}`.toLowerCase();
    return query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

// What the fixer is doing about a PR, on its row: only about the commit the PR is at now.
export function fixNote(run: FixRun | undefined, pr: PR, queued: string[]): { text: string; brick?: boolean } | undefined {
    if (!run || run.head !== pr.head) return undefined;
    const what = run.kind === "conflict" ? "the conflict" : "red CI";
    if (run.route === "pane") return { text: `${what} sent to its session` };
    if (queued.includes(run.id)) return { text: `fixing ${what} next` };
    if (!run.endedAt) return { text: run.startedAt ? `fixing ${what}…` : `fixing ${what} next` };
    if (run.exit === 0) return { text: `tried to fix ${what}${run.result ? `: ${run.result}` : ""}` };
    return { text: `fixing ${what} failed${run.result ? `: ${run.result}` : ""}`, brick: true };
}

// For the standup: your PRs that have waited a working day or more for someone's review. A few by
// name; more as counts per reviewer, which is what the team needs to hear.
// team: the reviewers that are your own team. Then only it is asked: how many wait on it, and a
// teammate by name only when they hold TEAM_NAMED or more.
const TEAM_NAMED = 3;
export function standupAsks(prs: PR[], me: string, now: number, team?: string[]): string | undefined {
    const waiting = prs.filter((p) => p.author === me && !p.isDraft && !p.mergedAt && p.reviewDecision !== "APPROVED" && p.reviewers.length > 0 && workingDaysBetween(lastMovement(p), now) >= 1);
    if (!waiting.length) return undefined;
    if (team) {
        const ours = waiting.filter((p) => p.reviewers.some((r) => team.includes(r)));
        if (!ours.length) return undefined;
        const per = new Map<string, number>();
        for (const p of ours) for (const r of p.reviewers) if (team.includes(r) && r !== team[0]) per.set(r, (per.get(r) ?? 0) + 1);
        const named = [...per].filter(([, n]) => n >= TEAM_NAMED).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${n} on ${r}`);
        return `${waiting.length} PR${waiting.length > 1 ? "s wait" : " waits"} for a review, ${ours.length} within the team${named.length ? `: ${named.join(", ")}` : ""}`;
    }
    if (waiting.length <= 2) return waiting.map((p) => `#${p.number} ${p.title} waits for a review from ${p.reviewers.join(" or ")}`).join("; ");
    const per = new Map<string, number>();
    for (const p of waiting) for (const r of p.reviewers) per.set(r, (per.get(r) ?? 0) + 1);
    return `${waiting.length} PRs wait for a review: ${[...per].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${n} on ${r}`).join(", ")}`;
}
