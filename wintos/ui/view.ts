import type { Wake, Wakes } from "../daemon/wakes/wakes";
import type { Day } from "../daemon/journal/journal";
import type { KeyStats } from "../daemon/keyboard/keyboard";
import type { PluginResult } from "../daemon/plugins/runner";
import type { Project } from "../daemon/projects/store";
import { ageLabel, byUrgency, GROUPS, groupOf, isSnoozed, isStacked, projectPrs, qualifier, type DonePr, type Group, type PR, type Snoozes } from "../daemon/prs/group";
import { fixNote } from "./prs";
import { liveSessionIn, liveSessionsIn, type Session } from "../daemon/sessions/reduce";
import { shelvedName, type Shelved } from "../daemon/shelf/shelf";
import type { FixerState } from "../daemon/fixer/runner";
import type { HeadsUp } from "../daemon/headsups/headsups";

export type WintosState = { now: number; sessions: Session[]; projects: Project[]; plugins?: Record<string, PluginResult>; pluginNames?: string[]; pluginsRunning?: string[]; snoozes?: Snoozes; seen?: Record<string, number>; day?: Day; lunch?: string; workday?: string; keyboard?: KeyStats; shelf?: Record<string, Shelved[]>; fixer?: FixerState; repoNames?: Record<string, string>; wakes?: Wakes; headsUps?: Record<string, HeadsUp[]>; headsUpProblem?: string; donePrs?: Record<string, DonePr> };
export type Tone = "apricot" | "blue" | "brick" | "secondary";
export type RowView = { title: string; next?: string; tone?: Tone; meta?: string; age: string; reason?: string };

export function relTime(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86_400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86_400)}d`;
}

// team: the reviewers that count as your own team (WINTOS_TEAM), when set.
export function ghPrs(state: WintosState): { me: string; prs: PR[]; team?: string[] } | undefined {
    return state.plugins?.["gh-prs"]?.data as { me: string; prs: PR[]; team?: string[] } | undefined;
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

// Which shelved session a closed project reopens on for a PR: the one that owns it, else one
// that touched it, else the newest (a review that only read the PR owns nothing yet).
export function reopenFor(shelf: Shelved[], url: string): Shelved | undefined {
    return shelf.find((s) => s.prs?.includes(url)) ?? shelf.find((s) => s.touched?.includes(url)) ?? shelf[0];
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

// Which projects each PR belongs to: its owner's first (the session that first touched it), then
// every project it is also in (a session there worked on it, or its project.md names it). Snoozed
// PRs included, and closed projects too: their shelf holds their sessions.
export function prProjectLists(tabIds: string[], state: WintosState): Map<string, string[]> {
    const gh = ghPrs(state);
    const out = new Map<string, string[]>();
    if (!gh) return out;
    const ids = [...tabIds, ...state.projects.filter((p) => p.id && !tabIds.includes(p.id)).map((p) => p.id!)];
    const add = (url: string, id: string, first = false) => {
        const list = (out.get(url) ?? []).filter((x) => x !== id);
        out.set(url, first ? [id, ...list] : [...list, id]);
    };
    for (const id of ids) {
        const p = state.projects.find((x) => x.id === id);
        const touched = [...state.sessions.filter((s) => s.tabId === id).flatMap((s) => s.touched ?? []), ...(state.shelf?.[id] ?? []).flatMap((i) => i.touched ?? [])];
        if (p) for (const { pr } of projectPrs({ ...p, pr: [...(p.pr ?? []), ...prOwners(state, id).keys(), ...touched] }, gh.prs, gh.me, state.now).items) add(pr.url, id);
    }
    // The owner's project leads, wherever it was found.
    for (const id of ids) for (const url of prOwners(state, id).keys()) if (out.has(url)) add(url, id, true);
    return out;
}

// The one project a PR goes to ("go to project"): its owner's.
export function prProjects(tabIds: string[], state: WintosState): Map<string, string> {
    return new Map([...prProjectLists(tabIds, state)].map(([url, ids]) => [url, ids[0]]));
}

// The header on a Claude pane: what it works on and what its PRs ask of you.
// wake: the next prompt it waits to be given (wintos wake).
export type SessionHeader = {
    session: Session;
    wake?: Wake;
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
    const wake = state.wakes?.[session.id];
    return { session, ...(task && { task }), ...(branch && { branch }), prs, ...(tone && { tone }), ...(wake && { wake }) };
}

// A session's PRs as chips: the open ones most urgent first, each saying what is next in plain
// words, then the done ones. status: what GitHub says, its icon. repo: its short name (repoLabel).
// Before the first PR fetch every PR shows as a bare number; one GitHub never told of, not at all.
export type PrStatus = "draft" | "open" | "merged" | "closed";
export type PrChip = { url: string; number: number; status?: PrStatus; group?: Group; text?: string; repo?: string };
export function prChips(state: WintosState, urls: string[]): PrChip[] {
    const gh = ghPrs(state);
    if (!gh) return urls.map((url) => ({ url, number: Number(url.split("/").pop()) }));
    const byUrl = new Map(gh.prs.map((p) => [p.url, p]));
    const label = repoLabeler(state);
    const listed = urls.flatMap((u) => byUrl.get(u) ?? []).map((pr): PrChip => {
        const group = groupOf(pr, gh.me, state.now);
        return { url: pr.url, number: pr.number, status: pr.mergedAt ? "merged" : pr.isDraft ? "draft" : "open", group, text: chipText(pr, group, state), repo: label(pr.repo) };
    });
    const done = urls.flatMap((u) => (byUrl.has(u) ? [] : (state.donePrs?.[u] ?? []))).map((d): PrChip => ({ url: d.url, number: d.number, status: d.merged ? "merged" : "closed", repo: label(d.repo) }));
    return [...listed.sort((a, b) => GROUPS.indexOf(a.group!) - GROUPS.indexOf(b.group!)), ...done];
}

// A PR as the window names it, by its repo's short name: "DMS #211".
export function prRef(state: WintosState, url: string): string {
    const m = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(url);
    return m ? `${repoLabeler(state)(m[1])} #${m[2]}` : url;
}

// Every repo's short name, given the PRs WintOS knows.
export function repoLabeler(state: WintosState): (repo: string) => string {
    const repos = ghPrs(state)?.prs.map((p) => p.repo) ?? [];
    return (repo) => repoLabel(repo, state.repoNames ?? {}, repos);
}

// A repo's short name: yours (n in the PR list), else its name without the dotted prefix most of
// the repos share and without a trailing ".Service".
export function repoLabel(repo: string, names: Record<string, string>, repos: string[]): string {
    if (names[repo]) return names[repo];
    const name = repo.split("/").pop()!;
    const prefixes = repos.map((r) => /^[^.]+\./.exec(r.split("/").pop()!)?.[0]).filter(Boolean);
    const common = prefixes.filter((p) => p === prefixes.sort((a, b) => prefixes.filter((x) => x === b).length - prefixes.filter((x) => x === a).length)[0])[0];
    const shared = common && prefixes.filter((p) => p === common).length * 2 >= new Set(repos).size ? common : undefined;
    const bare = shared && name.startsWith(shared) ? name.slice(shared.length) : name;
    return bare.replace(/\.Service$/, "") || name;
}

function chipText(pr: PR, group: Group, state: WintosState): string {
    const fixer = state.fixer;
    const fix = fixNote(fixer?.runs.find((r) => r.url === pr.url), pr, fixer?.queued ?? []);
    if (fix) return fix.text;
    const why = qualifier(pr, group)?.text;
    if (group === "merge") return why ?? "merge it";
    if (group === "fix") return why ?? "fix";
    if (group === "review") return "review asked";
    if (group === "team") return "team review";
    if (group === "chase") return ["chase", why, ageLabel(pr, state.now).text].filter(Boolean).join(" · ");
    return pr.isDraft && !why ? "draft" : (why ?? "waiting");
}

// The PR ⌥⌘G opens from the focused pane: the one the queue would put first (chips come sorted).
export const urgentPr = (h: SessionHeader | undefined) => h?.prs[0];

// What a live session is called: its name, else its first prompt. The status line is never the name.
export const sessionName = (s: Session) => s.name?.text ?? s.label ?? "session";

// A project's sessions, as its notes list them and ⌥⌘1–9 counts them: the live ones in pane
// order (blockIds, the tab's), then the shelved ones newest first; each with its PRs as chips.
// alsoIn: PRs another session owns that this one worked on too, while they are open.
export type ProjectSession = ({ kind: "live"; session: Session } | { kind: "shelved"; item: Shelved }) & { name: string; prs: PrChip[]; alsoIn: PrChip[] };
const alsoIn = (state: WintosState, urls: string[] = []) => prChips(state, urls).filter((c) => c.status !== "merged" && c.status !== "closed");
export function projectSessions(state: WintosState, tabId: string, blockIds: string[]): ProjectSession[] {
    const live = blockIds.flatMap((b) => liveSessionsIn(state.sessions.filter((s) => s.tabId === tabId), b));
    return [
        ...live.map((session): ProjectSession => ({ kind: "live", session, name: sessionName(session), prs: prChips(state, session.prs ?? []), alsoIn: alsoIn(state, session.touched) })),
        ...(state.shelf?.[tabId] ?? []).map((item): ProjectSession => ({ kind: "shelved", item, name: shelvedName(item), prs: prChips(state, item.prs ?? []), alsoIn: alsoIn(state, item.touched) })),
    ];
}

// The project's sessions that run only in Claude's background service: listed, never opened.
export const backgroundSessions = (state: WintosState, tabId: string): Session[] => state.sessions.filter((s) => s.tabId === tabId && s.background && s.state !== "ended");

// When you last interacted with a session (looked at it, or prompted it) and with a project (the
// latest of its sessions', live or shelved, and when you shelved one). Seen is kept per session.
export const sessionTouched = (state: WintosState, s: Session): number => Math.max(state.seen?.[s.id] ?? 0, s.promptAt ?? 0) || s.lastAt;
export function projectTouched(state: WintosState, tabId: string): number | undefined {
    const live = state.sessions.filter((s) => s.tabId === tabId).map((s) => sessionTouched(state, s));
    const shelved = (state.shelf?.[tabId] ?? []).map((i) => Math.max(i.at, state.seen?.[i.sessionId] ?? 0));
    const t = Math.max(0, ...live, ...shelved);
    return t || undefined;
}
