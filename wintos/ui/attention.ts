import { isUnread, rank, type Ranking, type Row } from "../daemon/ranking/rank";
import { liveSubagents, type Session } from "../daemon/sessions/reduce";
import type { Project } from "../daemon/projects/store";
import { isSnoozed, projectPrs, type ProjectPrs } from "../daemon/prs/group";
import type { Target } from "./sessions";
import { ghPrs, prOwners, prRef, relTime, repoLabeler, type Owner, type RowView, type WintosState } from "./view";
import { WOKE } from "./wakes";
import { heldUntil } from "../daemon/rhythm/hold";

// Which projects need you, why, and in what order: the one place that decides it. The sidebar,
// the palette and ⌃⇥ read it; it is given live sessions (those whose pane still exists).

export type AttentionPrs = ProjectPrs & { blocked?: ProjectPrs["blocked"] & { owner?: Owner } };

// A project's PRs: those its notes name (project.md, the ticket id) and those its sessions own,
// live or shelved. The one that needs you names who owns it.
export function prsByTab(tabIds: string[], state: WintosState): Record<string, AttentionPrs> {
    const gh = ghPrs(state);
    if (!gh) return {};
    const out: Record<string, AttentionPrs> = {};
    const awake = gh.prs.filter((pr) => !isSnoozed(pr, state.snoozes ?? {}, state.now));
    for (const id of tabIds) {
        const p = state.projects.find((x) => x.id === id);
        if (!p) continue;
        const owners = prOwners(state, id);
        const prs = projectPrs({ ...p, pr: [...(p.pr ?? []), ...owners.keys()] }, awake, gh.me, state.now);
        const owner = prs.blocked && owners.get(prs.blocked.url);
        out[id] = owner ? { ...prs, blocked: { ...prs.blocked!, owner, text: `${prs.blocked!.text} · ${"resume" in owner ? "shelved: " : ""}${owner.name}` } } : prs;
    }
    return out;
}

export function sidebarModel(tabIds: string[], state: WintosState): Ranking {
    const touched = Object.fromEntries(state.projects.filter((p) => p.id).map((p) => [p.id!, p.mtime]));
    return rank(tabIds, state.sessions, state.now, touched, state.seen);
}

export function rowView(row: Row, project: Project | undefined, tabName: string | undefined, now: number, prs?: ProjectPrs, label: (repo: string) => string = (r) => r.split("/").pop()!): RowView {
    const title = project?.title ?? tabName ?? "Untitled";
    const since = row.band === "needs" ? row.waitingSince! : row.lastAt;
    const age = since > 0 ? relTime(now - since) : "";
    const first = prs?.items[0]?.pr;
    // A PR only the notes name (not in the PR list): its short name, not its link.
    const noted = project?.pr?.[0]?.replace(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+).*$/, (_m, repo: string, n: string) => `${label(repo)} #${n}`);
    const link = first ? `${label(first.repo)} #${first.number} · ${first.branch}` : noted;
    // Restored at the last restart: shown as it was, but its Claude starts only when you open it.
    const notStarted = row.sessions.length > 0 && row.sessions.every((s) => s.restored);
    const meta = notStarted ? [link, "not started, opens with the project"].filter(Boolean).join(" · ") : link;
    if (project?.error) return { title, next: `note unreadable: ${project.dir}/project.md`, tone: "brick", age, meta };
    if (row.band === "needs") return { title, next: askLine(row.sessions) ?? project?.next ?? "Your turn", tone: "apricot", age, meta };
    if (row.band === "read") return { title, next: lastSaid(row.sessions) ?? project?.next ?? "New reply", tone: "blue", age, meta };
    if (row.band === "running") {
        // Parked beats the next action: it is the live reason nobody needs to act.
        const parkedOn = row.sessions.find((s) => s.state === "parked")?.parkedOn;
        const agents = row.sessions.some((s) => s.state === "working") ? 0 : row.sessions.reduce((n, s) => n + liveSubagents(s, now), 0);
        const behind = agents && `Waiting for ${agents} subagent${agents === 1 ? "" : "s"}; comes back by itself`;
        return { title, next: behind || (parkedOn ? `Waiting on ${parkedOn}` : (project?.next ?? "Claude is working")), tone: "secondary", age, meta };
    }
    const parkedOn = row.sessions.find((s) => s.state === "parked")?.parkedOn;
    // A PR that needs you no longer lifts the project: its line says so, quietly.
    return { title, age, reason: parkedOn ? `waiting on ${parkedOn}` : (lastSaid(row.sessions) ?? prs?.blocked?.text ?? prs?.reason ?? meta ?? age) };
}

// Open projects with a due wake on its way (the session resuming, or between turns): they stay
// in Your move until the prompt is typed, rather than passing through Quiet and back.
export function wakingTabs(state: WintosState, tabIds: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const w of Object.values(state.wakes ?? {})) {
        if (!w.due) continue;
        const live = state.sessions.find((s) => s.id === w.sessionId && s.state !== "ended");
        const tabId = live?.tabId ?? tabIds.find((id) => state.shelf?.[id]?.some((x) => x.sessionId === w.sessionId));
        if (tabId && tabIds.includes(tabId)) out[tabId] = `${prRef(state, w.pr)} ${WOKE[w.until]} · waking the session`;
    }
    return out;
}
export function waking(split: Ranking, tabs: Record<string, string>): Ranking {
    const moved = (rows: Row[]) => rows.filter((r) => tabs[r.tabId]);
    const kept = (rows: Row[]) => rows.filter((r) => !tabs[r.tabId]);
    const lifted = [...moved(split.read), ...moved(split.running), ...moved(split.quiet), ...moved(split.quietMore), ...moved(split.quietStale)].map((r) => ({ ...r, band: "needs" as const }));
    return { ...split, needs: [...lifted, ...split.needs], read: kept(split.read), running: kept(split.running), quiet: kept(split.quiet), quietMore: kept(split.quietMore), quietStale: kept(split.quietStale) };
}

// What the longest-waiting turn expects of you, ahead of what it said: "Decide · two bands or one".
// A turn not read yet shows what it said.
const ASK_LABEL = { answer: "Answer", decide: "Decide", approve: "Approve", unblock: "Unblock" } as const;
function askLine(sessions: Session[]): string | undefined {
    const s = sessions.filter((x) => x.state === "waiting").sort((a, b) => a.since - b.since)[0];
    if (!s?.ask) return s?.outcome?.text;
    // A question mid-turn is in the pane; the last turn's outcome would be stale.
    if (s.ask.by === "tool") return s.ask.kind === "approve" ? "Approve · its plan" : "Answer · its question";
    const what = s.ask.text ?? s.outcome?.text;
    return what ? `${ASK_LABEL[s.ask.kind]} · ${what}` : ASK_LABEL[s.ask.kind];
}

const lastSaid = (sessions: Session[]) => sessions.filter((s) => s.outcome).sort((a, b) => b.outcome!.at - a.outcome!.at)[0]?.outcome!.text;

// Everything the sidebar and the palette show about the projects, computed once: the bands,
// each row's text and each project's PRs. `now` ticks the ages.
// targets: where opening a project in Your move or To read lands: the session waiting longest,
// else the latest reply.
// held: what the hold keeps out of Your move for now (hold.ts), and when the first of it shows.
// here: the project you are in, never held.
export type Attention = Ranking & { views: Record<string, RowView>; prs: Record<string, AttentionPrs>; targets: Record<string, Target>; held?: { count: number; until: number } };
export function attention(tabIds: string[], state: WintosState, names: Record<string, string | undefined>, now: number, here?: string): Attention {
    const prs = prsByTab(tabIds, state);
    const lines = wakingTabs(state, tabIds);
    const { split, held } = holding(waking(sidebarModel(tabIds, state), lines), state, now, here, lines);
    const rows = [...split.needs, ...split.read, ...split.running, ...split.quiet, ...split.quietMore, ...split.quietStale];
    const project = (id: string) => state.projects.find((p) => p.id === id);
    const label = repoLabeler(state);
    const views = Object.fromEntries(rows.map((r) => [r.tabId, lines[r.tabId] ? { ...rowView(r, project(r.tabId), names[r.tabId], now, prs[r.tabId], label), next: lines[r.tabId], tone: "apricot" as const } : rowView(r, project(r.tabId), names[r.tabId], now, prs[r.tabId], label)]));
    for (const [tabId, until] of held.rows) views[tabId] = { ...views[tabId], reason: [`held ${until === Infinity ? "until you are back" : `for the ${clock(until)} batch`}`, askLine(rows.find((r) => r.tabId === tabId)!.sessions)].filter(Boolean).join(" · ") };
    const targets: Record<string, Target> = {};
    for (const r of [...split.needs, ...split.read]) {
        const waiting = r.sessions.filter((s) => s.state === "waiting").sort((a, b) => a.since - b.since)[0];
        const reply = r.sessions.filter((s) => isUnread(s, state.seen ?? {})).sort((a, b) => b.turnEndedAt! - a.turnEndedAt!)[0];
        const to = waiting ?? reply;
        if (to) targets[r.tabId] = { tabId: r.tabId, blockId: to.blockId };
    }
    return { ...split, views, prs, targets, ...(held.rows.size ? { held: { count: held.rows.size, until: Math.min(...held.rows.values()) } } : {}) };
}

const clock = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const QUICK = new Set(["approve"]);

// Your move without what the hold keeps back, which waits at the top of Quiet saying until when;
// what is left, the quick asks (an approval) first. A due wake is never held.
function holding(split: Ranking, state: WintosState, now: number, here: string | undefined, waking: Record<string, string>): { split: Ranking; held: { rows: Map<string, number> } } {
    const r = state.rhythm;
    const rows = new Map<string, number>();
    const ctx = r && { now, batchEveryMs: r.batchEveryMs ?? 0, releasedAt: r.releasedAt, breakFrom: r.onBreak ?? r.awayFrom, focus: r.focus, here };
    for (const row of split.needs) {
        const until = ctx && row.waitingSince !== undefined && !waking[row.tabId] ? heldUntil({ tabId: row.tabId, waitingSince: row.waitingSince }, ctx) : undefined;
        if (until !== undefined) rows.set(row.tabId, until);
    }
    const quick = (row: Row) => (row.sessions.some((s) => s.state === "waiting" && QUICK.has(s.ask?.kind ?? "")) ? 0 : 1);
    const needs = split.needs.filter((x) => !rows.has(x.tabId)).sort((a, b) => quick(a) - quick(b));
    const kept = split.needs.filter((x) => rows.has(x.tabId)).map((x) => ({ ...x, band: "quiet" as const }));
    return { split: { ...split, needs, quiet: [...kept, ...split.quiet] }, held: { rows } };
}
