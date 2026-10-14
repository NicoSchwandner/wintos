import { rank, type Ranking, type Row } from "../daemon/ranking/rank";
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

export function sidebarModel(tabIds: string[], state: WintosState): Ranking {
    const touched = Object.fromEntries(state.projects.filter((p) => p.id).map((p) => [p.id!, p.mtime]));
    return rank(tabIds, state.sessions, state.now, touched, state.seen);
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
        return { title, next: project?.next ?? "Your turn", tone: "apricot", age, meta };
    }
    if (row.band === "running") {
        // Parked beats the next action: it is the live reason nobody needs to act.
        const parkedOn = row.sessions.find((s) => s.state === "parked")?.parkedOn;
        return { title, next: parkedOn ? `Waiting on ${parkedOn}` : (project?.next ?? "Claude is working"), tone: "secondary", age, meta };
    }
    const parkedOn = row.sessions.find((s) => s.state === "parked")?.parkedOn;
    // A PR that needs you no longer lifts the project: its line says so, quietly.
    return { title, age, reason: parkedOn ? `waiting on ${parkedOn}` : (prs?.blocked?.text ?? prs?.reason ?? meta ?? age) };
}

// Everything the sidebar and the palette show about the projects, computed once: the bands,
// each row's text and each project's PRs. `now` ticks the ages.
// targets: where opening a project that needs you lands: the session waiting longest.
export type Attention = Ranking & { views: Record<string, RowView>; prs: Record<string, AttentionPrs>; targets: Record<string, Target> };
export function attention(tabIds: string[], state: WintosState, names: Record<string, string | undefined>, now: number): Attention {
    const prs = prsByTab(tabIds, state);
    const split = sidebarModel(tabIds, state);
    const rows = [...split.needs, ...split.running, ...split.quiet, ...split.quietMore, ...split.quietStale];
    const project = (id: string) => state.projects.find((p) => p.id === id);
    const views = Object.fromEntries(rows.map((r) => [r.tabId, rowView(r, project(r.tabId), names[r.tabId], now, prs[r.tabId])]));
    const targets: Record<string, Target> = {};
    for (const r of rows.filter((r) => r.band === "needs")) {
        const waiting = r.sessions.filter((s) => s.state === "waiting").sort((a, b) => a.since - b.since)[0];
        if (waiting) targets[r.tabId] = { tabId: r.tabId, blockId: waiting.blockId };
    }
    return { ...split, views, prs, targets };
}
