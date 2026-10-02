import { QUIET_CAP, rank, Ranking, Row } from "../daemon/ranking/rank";
import type { Day } from "../daemon/journal/journal";
import type { PluginResult } from "../daemon/plugins/runner";
import type { Project } from "../daemon/projects/store";
import { GROUPS, isSnoozed, isStacked, lastMovement, projectPrs, qualifier, type Group, type PR, type ProjectPrs, type Snoozes } from "../daemon/prs/group";
import type { Session } from "../daemon/sessions/reduce";

export type WintosState = { now: number; sessions: Session[]; projects: Project[]; plugins?: Record<string, PluginResult>; pluginNames?: string[]; pluginsRunning?: string[]; snoozes?: Snoozes; projectSnoozes?: Record<string, number>; seen?: Record<string, number>; day?: Day; lunch?: string };
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

// Snoozed projects (done, but may need re-work) leave the bands and the ⌘J/⌘K walk for their own
// group; one that needs you anew (a waiting session, a PR in Fix, a new reply, begun after the
// snooze) comes back, and is marked to be woken for good. A need already there when you snoozed
// is what you chose to put away.
export type SidebarSplit = Ranking & { snoozed: Row[]; wake: string[] };
export function withSnoozes(model: Ranking, snoozed: Record<string, number> = {}): SidebarSplit {
    const is = (r: Row) => r.tabId in snoozed;
    const out = (rows: Row[]) => rows.filter((r) => !is(r));
    const woken = (r: Row) => is(r) && (r.waitingSince ?? 0) > snoozed[r.tabId];
    const needs = model.needs.filter((r) => !is(r) || woken(r));
    return {
        needs,
        running: out(model.running),
        // The cap counts shown projects: a snoozed one gives its slot to the next.
        quiet: out([...model.quiet, ...model.quietMore]).slice(0, QUIET_CAP),
        quietMore: out([...model.quiet, ...model.quietMore]).slice(QUIET_CAP),
        quietStale: out(model.quietStale),
        // Put away: a snoozed project reads as quiet, whether a session there waits or works.
        snoozed: [...model.needs.filter((r) => is(r) && !woken(r)), ...model.running, ...model.quiet, ...model.quietMore, ...model.quietStale].filter(is).map((r) => ({ ...r, band: "quiet" as const })),
        wake: needs.filter(woken).map((r) => r.tabId),
    };
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

// The Inbox is the one tab that is not a project (pkg/wcore/inbox.go); a tab not loaded yet is one.
// Two Inbox tabs, PRs and On call; true is an Inbox from before the split, which held the PRs.
export type InboxList = "prs" | "oncall";
export function inboxKind(tab: Tab | undefined): InboxList | undefined {
    const v = tab?.meta?.["wintos:inbox"];
    return v === true || v === "prs" ? "prs" : v === "oncall" ? "oncall" : undefined;
}
export const isInboxTab = (tab: Tab | undefined) => inboxKind(tab) !== undefined;
// An empty placeholder saved by an earlier version (meta wintos:blank) is not a project either;
// one that gained panes is.
const oldPlaceholder = (tab: Tab | undefined) => tab?.meta?.["wintos:blank"] === true && !tab.blockids?.length;
export const projectTabIds = (ids: string[], tabs: Record<string, Tab | undefined>) => ids.filter((id) => !isInboxTab(tabs[id]) && !oldPlaceholder(tabs[id]));
export const inboxTabId = (ids: string[], tabs: Record<string, Tab | undefined>, list: InboxList) => ids.find((id) => inboxKind(tabs[id]) === list);

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

// Which project each PR belongs to, for "go to project" in the queue. Snoozed PRs included:
// snoozing a PR doesn't detach it from its project.
export function prProjects(tabIds: string[], state: WintosState): Map<string, string> {
    const gh = ghPrs(state);
    const out = new Map<string, string>();
    if (!gh) return out;
    for (const id of tabIds) {
        const p = state.projects.find((x) => x.id === id);
        if (p) for (const { pr } of projectPrs(p, gh.prs, gh.me, state.now).items) if (!out.has(pr.url)) out.set(pr.url, id);
    }
    return out;
}
