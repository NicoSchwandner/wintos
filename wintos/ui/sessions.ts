import { isUnread } from "../daemon/ranking/rank";
import type { Session } from "../daemon/sessions/reduce";

// find: open the notes at this text; resume: a shelved session's command; restore: a closed pane (⌘Z)
// unmagnify: land with magnify off when it shows another pane (⌃⇥: what needs you may sit
// behind the pane you magnified; both stay in view instead of magnify moving to it).
export type Target = { tabId: string; blockId: string; resume?: string; restore?: MetaType; unmagnify?: boolean };

// The daemon only hears about a session ending if Claude says so; a closed block or a killed
// Claude sends nothing. The UI knows which blocks still exist, so it drops the rest.
// An interrupted turn (Esc) sends no Stop either and stays "working" until the next prompt.
// A session only in Claude's background service shows in no pane and asks nothing of the
// sidebar: you can't act on it from WintOS.
export function liveSessions(sessions: Session[], blocksByTab: Record<string, string[] | undefined>): Session[] {
    return sessions.filter((s) => !s.background && blocksByTab[s.tabId]?.includes(s.blockId));
}

// ⇧⌘W asks first only when closing would stop Claude sessions; closing a tab kills its panes.
export function closeWarning(sessions: Session[], tabId: string): string | null {
    const n = sessions.filter((s) => s.tabId === tabId && s.state !== "ended").length;
    return n ? `${n} Claude session${n === 1 ? "" : "s"} will stop` : null;
}

// Closing a pane ends its Claude session; while one is working, the first ⌘W only warns.
export function paneCloseWarns(sessions: Session[], blockId: string, armed: string | null): boolean {
    return armed !== blockId && sessions.some((s) => s.blockId === blockId && s.state === "working");
}

// ⌃⇥: the next stop in Your move, then To read, in the order the sidebar shows it, wrapping, so every project
// there is reached and the next one can be read off the screen. A project's waiting sessions are
// a stop each (longest waiting first); a project there for a PR is one stop, the session behind
// it (attention's target) or else its terminals. A
// waiting session in a project not listed comes after the list.
export function nextNeedsYou(sessions: Session[], tabIds: string[], activeTabId: string, currentBlockId: string | undefined, needsTabIds: string[], targets: Record<string, Target> = {}): Target | { tabId: string } | null {
    const waiting = sessions.filter((s) => s.state === "waiting" && tabIds.includes(s.tabId)).sort((a, b) => a.since - b.since);
    const order = [...needsTabIds, ...waiting.map((s) => s.tabId)].filter((t, i, all) => tabIds.includes(t) && all.indexOf(t) === i);
    const stops: (Target | { tabId: string })[] = order.flatMap((tabId) => {
        // One stop per pane: a pane can hold two waiting sessions (a stale one under the live one),
        // and two identical stops in a row make ⌃⇥ land where you already are.
        const here = [...new Set(waiting.filter((s) => s.tabId === tabId).map((s) => s.blockId))].map((blockId) => ({ tabId, blockId }));
        return here.length ? here : [targets[tabId] ?? { tabId }];
    });
    if (!stops.length) return null;
    // A stop without a pane yet (a shelved session to resume) is the project itself: you are on it
    // once you are in the project, or ⌃⇥ would resume it again on every press.
    const at = stops.findIndex((t) => t.tabId === activeTabId && (!("blockId" in t) || !t.blockId || t.blockId === currentBlockId));
    if (at >= 0) return stops[(at + 1) % stops.length];
    // In a listed project but not on one of its stops: its first. Anywhere else: the top.
    return stops.find((t) => t.tabId === activeTabId) ?? stops[0];
}

// A reply you haven't seen: the session's last turn ended after you last looked at it.
export function unreadSessions(sessions: Session[], tabId: string, seen: Record<string, number> | undefined): Session[] {
    return sessions.filter((s) => s.tabId === tabId && isUnread(s, seen ?? {}));
}

// Panes of this tab that resume a session WintOS places elsewhere: a `claude attach` shows it,
// while its events come from the background service with an old pane's id.
// sent: the panes this window already attached. Each attaches once: two panes resuming one session
// (the same project open twice) would otherwise take it back from each other on every state.
export function attachments(panes: { blockId: string; script?: string }[], sessions: Session[], tabId: string, sent: ReadonlySet<string>): { sessionId: string; blockId: string }[] {
    return panes.flatMap(({ blockId, script }) => {
        const id = script && /--resume '([\w-]+)'/.exec(script)?.[1];
        const s = id ? sessions.find((x) => x.id === id && x.state !== "ended") : undefined;
        return s && (s.blockId !== blockId || s.tabId !== tabId) && !sent.has(`${s.id}@${blockId}`) ? [{ sessionId: s.id, blockId }] : [];
    });
}
