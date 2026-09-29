import { isUnread } from "../daemon/ranking/rank";
import type { Session } from "../daemon/sessions/reduce";

export type Target = { tabId: string; blockId: string };

// The daemon only hears about a session ending if Claude says so; a closed block or a killed
// Claude sends nothing. The UI knows which blocks still exist, so it drops the rest.
// An interrupted turn (Esc) sends no Stop either and stays "working" until the next prompt.
export function liveSessions(sessions: Session[], blocksByTab: Record<string, string[] | undefined>): Session[] {
    return sessions.filter((s) => blocksByTab[s.tabId]?.includes(s.blockId));
}

export function stripSessions(sessions: Session[], tabId: string): Session[] {
    return sessions.filter((s) => s.tabId === tabId && s.state !== "ended");
}

// ⌃⇥: the next waiting session in this tab after the current one, cycling; failing that,
// the longest wait in any other tab of this workspace.
export function nextWaiting(sessions: Session[], tabIds: string[], activeTabId: string, currentBlockId?: string): Target | null {
    const waiting = sessions.filter((s) => s.state === "waiting" && tabIds.includes(s.tabId));
    const here = waiting.filter((s) => s.tabId === activeTabId);
    const elsewhere = waiting.filter((s) => s.tabId !== activeTabId);
    const onlyCurrentHere = here.length === 1 && here[0].blockId === currentBlockId;
    if (here.length && !(onlyCurrentHere && elsewhere.length)) {
        const i = here.findIndex((s) => s.blockId === currentBlockId);
        const next = here[(i + 1) % here.length];
        return { tabId: next.tabId, blockId: next.blockId };
    }
    const oldest = [...elsewhere].sort((a, b) => a.since - b.since)[0];
    return oldest ? { tabId: oldest.tabId, blockId: oldest.blockId } : null;
}

// ⇧⌘W asks first only when closing would stop Claude sessions; closing a tab kills its panes.
export function closeWarning(sessions: Session[], tabId: string): string | null {
    const n = sessions.filter((s) => s.tabId === tabId && s.state !== "ended").length;
    return n ? `${n} Claude session${n === 1 ? "" : "s"} will stop` : null;
}

// ⌃⇥ in full: a waiting session first; failing that, the next project in Needs you, which may
// be there for a PR rather than a session.
export function nextNeedsYou(sessions: Session[], tabIds: string[], activeTabId: string, currentBlockId: string | undefined, needsTabIds: string[]): Target | { tabId: string } | null {
    const waiting = nextWaiting(sessions, tabIds, activeTabId, currentBlockId);
    if (waiting) return waiting;
    if (!needsTabIds.length) return null;
    return { tabId: needsTabIds[(needsTabIds.indexOf(activeTabId) + 1) % needsTabIds.length] };
}

// A reply you haven't seen: the session's last turn ended after you last looked at its project.
export function unreadSessions(sessions: Session[], tabId: string, seenAt: number | undefined): Session[] {
    return sessions.filter((s) => s.tabId === tabId && isUnread(s, seenAt ?? 0));
}
