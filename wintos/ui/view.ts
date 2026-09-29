import { rank, Ranking, Row } from "../daemon/ranking/rank";
import type { PluginResult } from "../daemon/plugins/runner";
import type { Project } from "../daemon/projects/store";
import { GROUPS, isSnoozed, isStacked, lastMovement, projectPrs, qualifier, type Group, type PR, type ProjectPrs, type Snoozes } from "../daemon/prs/group";
import type { Session } from "../daemon/sessions/reduce";

export type WintosState = { now: number; sessions: Session[]; projects: Project[]; plugins?: Record<string, PluginResult>; pluginNames?: string[]; pluginsRunning?: string[]; snoozes?: Snoozes; seen?: Record<string, number> };
export type Tone = "apricot" | "brick" | "secondary";
export type RowView = { title: string; next?: string; tone?: Tone; meta?: string; age: string; reason?: string };

export function relTime(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86_400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86_400)}d`;
}

export function ghPrs(state: WintosState): { me: string; prs: PR[] } | undefined {
    return state.plugins?.["gh-prs"]?.data as { me: string; prs: PR[] } | undefined;
}

export function prsByTab(tabIds: string[], state: WintosState): Record<string, ProjectPrs> {
    const gh = ghPrs(state);
    if (!gh) return {};
    const out: Record<string, ProjectPrs> = {};
    const awake = gh.prs.filter((pr) => !isSnoozed(pr, state.snoozes ?? {}, state.now));
    for (const id of tabIds) {
        const p = state.projects.find((x) => x.id === id);
        if (p) out[id] = projectPrs(p, awake, gh.me, state.now);
    }
    return out;
}

export function sidebarModel(tabIds: string[], state: WintosState): Ranking {
    const touched = Object.fromEntries(state.projects.filter((p) => p.id).map((p) => [p.id!, p.mtime]));
    const byTab = prsByTab(tabIds, state);
    const blocked = Object.fromEntries(Object.entries(byTab).filter(([, v]) => v.blocked).map(([k, v]) => [k, v.blocked!.since]));
    return rank(tabIds, state.sessions, state.now, touched, blocked, state.seen);
}

export function rowView(row: Row, project: Project | undefined, tabName: string | undefined, now: number, prs?: ProjectPrs): RowView {
    const title = project?.title ?? tabName ?? "Untitled";
    const since = row.band === "needs" ? row.waitingSince! : row.lastAt;
    const age = since > 0 ? relTime(now - since) : "";
    const first = prs?.items[0]?.pr;
    const link = first ? `#${first.number} · ${first.branch}` : project?.pr?.[0];
    // Restored at the last restart: shown as it was, but its Claude starts only when you open it.
    const notStarted = row.sessions.length > 0 && row.sessions.every((s) => s.restored);
    const meta = notStarted ? [link, "not started, opens with the project"].filter(Boolean).join(" · ") : link;
    if (project?.error) return { title, next: `note unreadable: ${project.dir}/project.md`, tone: "brick", age, meta };
    if (row.band === "needs") {
        const sessionWaiting = row.sessions.some((s) => s.state === "waiting");
        if (!sessionWaiting && row.unread) return { title, next: project?.next ? `New reply · ${project.next}` : "New reply", tone: "apricot", age, meta };
        if (!sessionWaiting && prs?.blocked) return { title, next: prs.blocked.text, tone: prs.blocked.tone, age, meta };
        return { title, next: project?.next ?? "Your turn", tone: "apricot", age, meta };
    }
    if (row.band === "running") {
        // Parked beats the next action: it is the live reason nobody needs to act.
        const parkedOn = row.sessions.find((s) => s.state === "parked")?.parkedOn;
        return { title, next: parkedOn ? `Waiting on ${parkedOn}` : (project?.next ?? "Claude is working"), tone: "secondary", age, meta };
    }
    return { title, age, reason: prs?.reason ?? meta ?? age };
}

// The tab wcore leaves when the last project closes (a window can't hold zero tabs). It is
// not a project until a pane opens in it.
export function isPlaceholderTab(tab: Tab | undefined): boolean {
    return tab?.meta?.["wintos:blank"] === true && !tab.blockids?.length;
}

// The notes' Pull requests section: every PR of the project, snoozed ones included (marked,
// last), most urgent group first, each with what it waits on.
export type ProjectPrRow = { pr: PR; group: Group; note?: string; snoozed: boolean };

export function projectPrList(state: WintosState, tabId: string): ProjectPrRow[] {
    const gh = ghPrs(state);
    const project = state.projects.find((p) => p.id === tabId);
    if (!gh || !project) return [];
    const numbers = new Map(gh.prs.map((p) => [p.url, p.number]));
    const rows = projectPrs(project, gh.prs, gh.me, state.now).items.map(({ pr, group }): ProjectPrRow => {
        const on = !isStacked(pr) ? undefined : pr.stackedOn && numbers.has(pr.stackedOn) ? `#${numbers.get(pr.stackedOn)}` : pr.base;
        const note = [qualifier(pr, group)?.text, on && `stacked on ${on}`].filter(Boolean).join(" · ") || undefined;
        return { pr, group, note, snoozed: isSnoozed(pr, state.snoozes ?? {}, state.now) };
    });
    return rows.sort(
        (a, b) => Number(a.snoozed) - Number(b.snoozed) || GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || lastMovement(a.pr).localeCompare(lastMovement(b.pr))
    );
}
