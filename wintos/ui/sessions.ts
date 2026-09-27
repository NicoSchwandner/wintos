import type { Session } from "../daemon/sessions/reduce";

export type Target = { tabId: string; blockId: string };

export function stripSessions(sessions: Session[], tabId: string): Session[] {
    return sessions.filter((s) => s.tabId === tabId && s.state !== "ended");
}

// ⌃⇥: the next waiting session in this tab after the current one, cycling; failing that,
// the longest wait in any other tab of this workspace.
export function nextWaiting(sessions: Session[], tabIds: string[], activeTabId: string, currentBlockId?: string): Target | null {
    const waiting = sessions.filter((s) => s.state === "waiting" && tabIds.includes(s.tabId));
    const here = waiting.filter((s) => s.tabId === activeTabId);
    if (here.length) {
        const i = here.findIndex((s) => s.blockId === currentBlockId);
        const next = here[(i + 1) % here.length];
        return { tabId: next.tabId, blockId: next.blockId };
    }
    const oldest = [...waiting].sort((a, b) => a.since - b.since)[0];
    return oldest ? { tabId: oldest.tabId, blockId: oldest.blockId } : null;
}
