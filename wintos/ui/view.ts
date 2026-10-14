import type { Day } from "../daemon/journal/journal";
import type { KeyStats } from "../daemon/keyboard/keyboard";
import type { PluginResult } from "../daemon/plugins/runner";
import type { Project } from "../daemon/projects/store";
import { byUrgency, GROUPS, groupOf, isSnoozed, isStacked, projectPrs, qualifier, type Group, type PR, type Snoozes } from "../daemon/prs/group";
import { liveSessionIn, liveSessionsIn, type Session } from "../daemon/sessions/reduce";
import { shelvedName, type Shelved } from "../daemon/shelf/shelf";

export type WintosState = { now: number; sessions: Session[]; projects: Project[]; plugins?: Record<string, PluginResult>; pluginNames?: string[]; pluginsRunning?: string[]; snoozes?: Snoozes; seen?: Record<string, number>; day?: Day; lunch?: string; workday?: string; keyboard?: KeyStats; shelf?: Record<string, Shelved[]> };
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

// Who owns a PR in a project: the live session there that touched it last, else a shelved one
// (resumed by its script). One owner each; the daemon moves a PR to whoever touches it.
export type Owner = { name: string; blockId: string } | { name: string; resume: string };
export function prOwners(state: WintosState, tabId: string): Map<string, Owner> {
    const owners = new Map<string, Owner>();
    for (const s of state.shelf?.[tabId] ?? []) for (const u of s.prs ?? []) owners.set(u, { name: shelvedName(s), resume: s.script });
    for (const s of state.sessions.filter((s) => s.tabId === tabId && s.state !== "ended")) for (const u of s.prs ?? []) owners.set(u, { name: sessionName(s), blockId: s.blockId });
    return owners;
}

// The notes' Pull requests section: every PR of the project, snoozed ones included (marked,
// last), most urgent group first, each with what it waits on.
export type ProjectPrRow = { pr: PR; group: Group; note?: string; snoozed: boolean };

export function projectPrList(state: WintosState, tabId: string): ProjectPrRow[] {
    const gh = ghPrs(state);
    const project = state.projects.find((p) => p.id === tabId);
    if (!gh || !project) return [];
    const numbers = new Map(gh.prs.map((p) => [p.url, p.number]));
    // A PR a session here owns is on that session's pane header, or its shelf row, instead.
    const owned = new Set(prOwners(state, tabId).keys());
    const rows = projectPrs(project, gh.prs.filter((p) => !owned.has(p.url)), gh.me, state.now).items.map(({ pr, group }): ProjectPrRow => {
        const on = !isStacked(pr) ? undefined : pr.stackedOn && numbers.has(pr.stackedOn) ? `#${numbers.get(pr.stackedOn)}` : pr.base;
        const note = [qualifier(pr, group)?.text, on && `stacked on ${on}`].filter(Boolean).join(" · ") || undefined;
        return { pr, group, note, snoozed: isSnoozed(pr, state.snoozes ?? {}, state.now) };
    });
    return rows.sort((a, b) => Number(a.snoozed) - Number(b.snoozed) || byUrgency(a, b));
}

// Which project each PR belongs to, for "go to project" in the queue. Snoozed PRs included:
// snoozing a PR doesn't detach it from its project.
export function prProjects(tabIds: string[], state: WintosState): Map<string, string> {
    const gh = ghPrs(state);
    const out = new Map<string, string>();
    if (!gh) return out;
    for (const id of tabIds) {
        const p = state.projects.find((x) => x.id === id);
        if (p) for (const { pr } of projectPrs({ ...p, pr: [...(p.pr ?? []), ...prOwners(state, id).keys()] }, gh.prs, gh.me, state.now).items) if (!out.has(pr.url)) out.set(pr.url, id);
    }
    return out;
}

// The header on a Claude pane: what it works on and what its PRs ask of you.
export type SessionHeader = {
    session: Session;
    task?: string;
    branch?: string;
    prs: PrChip[];
    tone?: "apricot" | "brick"; // a PR here needs a fix (apricot) or is past the SLA (brick)
};

const TASK_ID = /\b[A-Z][A-Z0-9]+-\d+\b/i;

export function sessionHeader(state: WintosState, blockId: string): SessionHeader | undefined {
    const session = liveSessionIn(state.sessions, blockId);
    if (!session) return undefined;
    const gh = ghPrs(state);
    const byUrl = new Map((gh?.prs ?? []).map((p) => [p.url, p]));
    const prs = prChips(state, session.prs ?? []);
    const open = (session.prs ?? []).map((u) => byUrl.get(u)).filter((p): p is PR => !!p);
    const where = session.cwd?.split("/").pop();
    const branch = open[0]?.branch ?? where;
    const task = [...open.flatMap((p) => [p.branch, p.title]), where ?? ""].map((t) => TASK_ID.exec(t)?.[0]).find(Boolean)?.toUpperCase();
    const groups = prs.map((p) => p.group);
    const tone = groups.some((g) => g === "chase" || g === "release") ? "brick" : groups.includes("fix") ? "apricot" : undefined;
    return { session, ...(task && { task }), ...(branch && { branch }), prs, ...(tone && { tone }) };
}

// A session's PRs as chips: the number, the queue group and what it waits on. A PR the PR
// list doesn't show (closed, or not fetched yet) is the bare number.
export type PrChip = { url: string; number: number; group?: Group; why?: string };
export function prChips(state: WintosState, urls: string[]): PrChip[] {
    const gh = ghPrs(state);
    const byUrl = new Map((gh?.prs ?? []).map((p) => [p.url, p]));
    return urls.map((url) => {
        const pr = byUrl.get(url);
        const number = Number(url.split("/").pop());
        if (!pr || !gh) return { url, number };
        const group = groupOf(pr, gh.me, state.now);
        const why = qualifier(pr, group)?.text;
        return why ? { url, number, group, why } : { url, number, group };
    });
}

// The PR ⌥⌘G opens from the focused pane: the one the queue would put first.
export const urgentPr = (h: SessionHeader | undefined) =>
    h?.prs.filter((p) => p.group).sort((a, b) => GROUPS.indexOf(a.group!) - GROUPS.indexOf(b.group!))[0] ?? h?.prs[0];

// What a live session is called: the status line it keeps (`wintos status`), else its first prompt.
export const sessionName = (s: Session) => s.status?.text ?? s.label ?? "session";

// A project's sessions, as its notes list them and ⌥⌘1–9 counts them: the live ones in pane
// order (blockIds, the tab's), then the shelved ones newest first; each with its PRs as chips.
export type ProjectSession = { kind: "live"; session: Session; name: string; prs: PrChip[] } | { kind: "shelved"; item: Shelved; name: string; prs: PrChip[] };
export function projectSessions(state: WintosState, tabId: string, blockIds: string[]): ProjectSession[] {
    const live = blockIds.flatMap((b) => liveSessionsIn(state.sessions.filter((s) => s.tabId === tabId), b));
    return [
        ...live.map((session): ProjectSession => ({ kind: "live", session, name: sessionName(session), prs: prChips(state, session.prs ?? []) })),
        ...(state.shelf?.[tabId] ?? []).map((item): ProjectSession => ({ kind: "shelved", item, name: shelvedName(item), prs: prChips(state, item.prs ?? []) })),
    ];
}
