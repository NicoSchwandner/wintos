import { isUnread } from "../daemon/ranking/rank";
import type { Session } from "../daemon/sessions/reduce";

export type Target = { tabId: string; blockId: string; find?: string; resume?: string }; // find: open the notes at this text; resume: a shelved session's command

// The daemon only hears about a session ending if Claude says so; a closed block or a killed
// Claude sends nothing. The UI knows which blocks still exist, so it drops the rest.
// An interrupted turn (Esc) sends no Stop either and stays "working" until the next prompt.
export function liveSessions(sessions: Session[], blocksByTab: Record<string, string[] | undefined>): Session[] {
    return sessions.filter((s) => blocksByTab[s.tabId]?.includes(s.blockId));
}

// ⇧⌘W asks first only when closing would stop Claude sessions; closing a tab kills its panes.
export function closeWarning(sessions: Session[], tabId: string): string | null {
    const n = sessions.filter((s) => s.tabId === tabId && s.state !== "ended").length;
    return n ? `${n} Claude session${n === 1 ? "" : "s"} will stop` : null;
}

// ⌃⇥: the next stop in Needs you, in the order the sidebar shows it, wrapping, so every project
// there is reached and the next one can be read off the screen. A project's waiting sessions are
// a stop each (longest waiting first); a project there for a PR is one stop, its terminals. A
// waiting session in a project not listed comes after the list.
export function nextNeedsYou(sessions: Session[], tabIds: string[], activeTabId: string, currentBlockId: string | undefined, needsTabIds: string[]): Target | { tabId: string } | null {
    const waiting = sessions.filter((s) => s.state === "waiting" && tabIds.includes(s.tabId)).sort((a, b) => a.since - b.since);
    const order = [...needsTabIds, ...waiting.map((s) => s.tabId)].filter((t, i, all) => tabIds.includes(t) && all.indexOf(t) === i);
    const stops: (Target | { tabId: string })[] = order.flatMap((tabId) => {
        const here = waiting.filter((s) => s.tabId === tabId).map((s) => ({ tabId, blockId: s.blockId }));
        return here.length ? here : [{ tabId }];
    });
    if (!stops.length) return null;
    const at = stops.findIndex((t) => t.tabId === activeTabId && (!("blockId" in t) || t.blockId === currentBlockId));
    if (at >= 0) return stops[(at + 1) % stops.length];
    // In a listed project but not on one of its stops: its first. Anywhere else: the top.
    return stops.find((t) => t.tabId === activeTabId) ?? stops[0];
}

// A reply you haven't seen: the session's last turn ended after you last looked at its project.
export function unreadSessions(sessions: Session[], tabId: string, seenAt: number | undefined): Session[] {
    return sessions.filter((s) => s.tabId === tabId && isUnread(s, seenAt ?? 0));
}
