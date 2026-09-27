import { ageLabel, Group, GROUPS, groupOf, PR, qualifier } from "../daemon/prs/group";

export type QueueRow = { pr: PR; group: Group; mine: boolean; age: { text: string; late: boolean }; qualifier?: { text: string; brick?: boolean }; total: number; repoShort: string };
export type QueueModel = { groups: { group: Group; rows: QueueRow[] }[]; yours: number; team: number; pastSla: number };

export function queueModel(prs: PR[], me: string, now: number): QueueModel {
    const rows = prs.map((pr): QueueRow => {
        const group = groupOf(pr, me, now);
        return { pr, group, mine: pr.author === me, age: ageLabel(pr, now), qualifier: qualifier(pr, group), total: pr.additions + pr.deletions, repoShort: pr.repo.split("/").pop()! };
    });
    const groups = GROUPS.map((group) => ({ group, rows: rows.filter((r) => r.group === group).sort((a, b) => Number(b.age.late) - Number(a.age.late)) })).filter((g) => g.rows.length);
    const team = rows.filter((r) => r.group === "team").length;
    return {
        groups,
        yours: rows.length - team,
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
