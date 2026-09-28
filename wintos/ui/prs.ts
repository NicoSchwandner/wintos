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
        return { pr, group, mine: pr.author === me, age: ageLabel(pr, now), qualifier: qualifier(pr, group), total: pr.additions + pr.deletions, repoShort: pr.repo.split("/").pop()!, children: [] };
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
