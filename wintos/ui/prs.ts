import { ageLabel, Group, GROUPS, groupOf, isSnoozed, isStacked, lastMovement, PR, qualifier, type Snoozes } from "../daemon/prs/group";

// children: PRs stacked on this one that only wait for it (spec: stacked PRs sit under their base).
export type QueueRow = { pr: PR; group: Group; mine: boolean; age: { text: string; late: boolean }; qualifier?: { text: string; brick?: boolean }; total: number; repoShort: string; children: QueueRow[] };

const ACTS: Group[] = ["merge", "fix", "review", "chase"];

// Longest untouched first: the older the last review or push, the more it is owed.
const byUrgency = (a: QueueRow, b: QueueRow) => lastMovement(a.pr).localeCompare(lastMovement(b.pr));
// snoozed: looked at and handed on; out of the groups and the counts until it wakes.
export type QueueModel = { groups: { group: Group; rows: QueueRow[] }[]; snoozed: QueueRow[]; yours: number; waiting: number; team: number; pastSla: number };

export function queueModel(prs: PR[], me: string, now: number, snoozes: Snoozes = {}): QueueModel {
    const toRow = (pr: PR): QueueRow => {
        const group = groupOf(pr, me, now);
        return { pr, group, mine: pr.author === me, age: ageLabel(pr, now), qualifier: qualifier(pr, group, { reviewers: false }), total: pr.additions + pr.deletions, repoShort: pr.repo.split("/").pop()!, children: [] };
    };
    const snoozed = prs.filter((p) => isSnoozed(p, snoozes, now)).map(toRow);
    const all = prs.filter((p) => !isSnoozed(p, snoozes, now)).map(toRow);
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
    const groups = GROUPS.map((group) => ({ group, rows: rows.filter((r) => r.group === group).sort(byUrgency) })).filter((g) => g.rows.length);
    const team = rows.filter((r) => r.group === "team").length;
    const waiting = rows.filter((r) => r.group === "waiting").length;
    return {
        groups,
        snoozed,
        yours: rows.length - team - waiting,
        waiting,
        team,
        pastSla: rows.filter((r) => r.group === "chase" || (r.group === "review" && r.age.late)).length,
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
// A ready PR nobody is asked on shows "none"; a draft is nobody's yet.
// With nobody still asked, whoever approved is shown (✓) instead.
export function reviewerChips(pr: PR, max: number): { chips: string[]; more: number; none: boolean; approved: string[] } {
    const approved = pr.reviewers.length ? [] : (pr.approvedBy ?? []).slice(0, max);
    return { chips: pr.reviewers.slice(0, max), more: Math.max(0, pr.reviewers.length - max), none: !pr.isDraft && pr.reviewers.length === 0 && !approved.length, approved };
}

// Which optional columns fit beside a readable title: the size bar goes first, then the names
// (the author's, and reviewers' in full rather than initials).
export type RowColumns = { size: boolean; names: boolean };
export const rowColumns = (width: number): RowColumns => ({ size: width >= 1000, names: width >= 850 });
