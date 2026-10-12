import { QUIET_CAP, rank, type Ranking, type Row } from "../daemon/ranking/rank";
import type { Project } from "../daemon/projects/store";
import { isSnoozed, projectPrs, type ProjectPrs } from "../daemon/prs/group";
import type { Target } from "./sessions";
import { ghPrs, prOwners, relTime, type Owner, type RowView, type WintosState } from "./view";

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

export function sidebarModel(tabIds: string[], state: WintosState, byTab = prsByTab(tabIds, state)): Ranking {
    const touched = Object.fromEntries(state.projects.filter((p) => p.id).map((p) => [p.id!, p.mtime]));
    const blocked = Object.fromEntries(Object.entries(byTab).filter(([, v]) => v.blocked).map(([k, v]) => [k, v.blocked!.since]));
    return rank(tabIds, state.sessions, state.now, touched, blocked, state.seen);
}

// Snoozed projects (done, but may need re-work) leave the bands and the ⌘J/⌘K walk for their own
// group; one that needs you anew (a waiting session, a PR that needs you, a new reply, begun after the
// snooze) comes back, and is marked to be woken for good. A need already there when you snoozed
// is what you chose to put away.
export type SidebarSplit = Ranking & { snoozed: Row[]; wake: string[] };
export function withSnoozes(model: Ranking, snoozed: Record<string, number> = {}): SidebarSplit {
    const is = (r: Row) => r.tabId in snoozed;
    const out = (rows: Row[]) => rows.filter((r) => !is(r));
    const woken = (r: Row) => is(r) && (r.latestNeed ?? r.waitingSince ?? 0) > snoozed[r.tabId];
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
        // A PR keeps it here; a deploy done by hand may never turn it green, so ⌥⌘Z lets it sleep.
        if (!sessionWaiting && prs?.blocked) return { title, next: prs.blocked.text, tone: prs.blocked.tone, age, meta, sleepable: true };
        return { title, next: project?.next ?? "Your turn", tone: "apricot", age, meta };
    }
    if (row.band === "running") {
        // Parked beats the next action: it is the live reason nobody needs to act.
        const parkedOn = row.sessions.find((s) => s.state === "parked")?.parkedOn;
        return { title, next: parkedOn ? `Waiting on ${parkedOn}` : (project?.next ?? "Claude is working"), tone: "secondary", age, meta };
    }
    const parkedOn = row.sessions.find((s) => s.state === "parked")?.parkedOn;
    return { title, age, reason: parkedOn ? `waiting on ${parkedOn}` : (prs?.reason ?? meta ?? age) };
}

// Everything the sidebar and the palette show about the projects, computed once: the bands
// (snoozes applied), each row's text and each project's PRs. `now` ticks the ages.
// targets: where opening a project that needs you lands, the session behind the need: the one
// waiting longest, else the one (live, or shelved and resumed) owning the PR that needs you.
export type Attention = SidebarSplit & { views: Record<string, RowView>; prs: Record<string, AttentionPrs>; targets: Record<string, Target> };
export function attention(tabIds: string[], state: WintosState, names: Record<string, string | undefined>, now: number): Attention {
    const prs = prsByTab(tabIds, state);
    const split = withSnoozes(sidebarModel(tabIds, state, prs), state.projectSnoozes);
    const rows = [...split.needs, ...split.running, ...split.quiet, ...split.quietMore, ...split.quietStale, ...split.snoozed];
    const project = (id: string) => state.projects.find((p) => p.id === id);
    const views = Object.fromEntries(rows.map((r) => [r.tabId, rowView(r, project(r.tabId), names[r.tabId], now, prs[r.tabId])]));
    const targets: Record<string, Target> = {};
    for (const r of rows.filter((r) => r.band === "needs")) {
        const waiting = r.sessions.filter((s) => s.state === "waiting").sort((a, b) => a.since - b.since)[0];
        const owner = prs[r.tabId]?.blocked?.owner;
        if (waiting) targets[r.tabId] = { tabId: r.tabId, blockId: waiting.blockId };
        else if (owner) targets[r.tabId] = "resume" in owner ? { tabId: r.tabId, blockId: "", resume: owner.resume } : { tabId: r.tabId, blockId: owner.blockId };
    }
    return { ...split, views, prs, targets };
}
