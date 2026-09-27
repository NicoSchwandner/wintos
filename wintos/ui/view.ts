import { rank, Ranking, Row } from "../daemon/ranking/rank";
import type { Project } from "../daemon/projects/store";
import type { Session } from "../daemon/sessions/reduce";

export type WintosState = { now: number; sessions: Session[]; projects: Project[] };
export type Tone = "apricot" | "brick" | "secondary";
export type RowView = { title: string; next?: string; tone?: Tone; meta?: string; age: string; reason?: string };

export function relTime(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86_400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86_400)}d`;
}

export function sidebarModel(tabIds: string[], state: WintosState): Ranking {
    const touched = Object.fromEntries(state.projects.filter((p) => p.id).map((p) => [p.id!, p.mtime]));
    return rank(tabIds, state.sessions, state.now, touched);
}

export function rowView(row: Row, project: Project | undefined, tabName: string | undefined, now: number): RowView {
    const title = project?.title ?? tabName ?? "Untitled";
    const since = row.band === "needs" ? row.waitingSince! : row.lastAt;
    const age = since > 0 ? relTime(now - since) : "";
    const meta = project?.pr?.[0];
    if (project?.error) return { title, next: `note unreadable: ${project.dir}/project.md`, tone: "brick", age, meta };
    if (row.band === "needs") return { title, next: project?.next ?? "Your turn", tone: "apricot", age, meta };
    if (row.band === "running") return { title, next: project?.next ?? "Claude is working", tone: "secondary", age, meta };
    return { title, age, reason: meta ?? age };
}
