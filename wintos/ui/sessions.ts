import { isUnread } from "../daemon/ranking/rank";
import { liveSubagents, type Session } from "../daemon/sessions/reduce";

// resume: a shelved session's command; restore: a closed pane (⌘Z).
export type Target = { tabId: string; blockId: string; resume?: string; restore?: MetaType };

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

// Auto-close: the sessions of a tab that said they're done, that you have read, and whose PRs
// are all merged or closed. open: the urls of PRs still open.
export function autoClosable(sessions: Session[], tabId: string, seen: Record<string, number> | undefined, open: ReadonlySet<string>): Session[] {
    return sessions.filter((s) => s.tabId === tabId && s.state === "done" && !isUnread(s, seen ?? {}) && !(s.prs ?? []).some((u) => open.has(u)));
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

// What restarting WintOS would stop: turns in flight, and subagents still running, also behind a
// turn that ended. Claude's background service is not WintOS's to stop.
export function atWork(sessions: Session[], now: number): { working: number; subagents: number } {
    const running = sessions.filter((s) => s.state !== "ended" && !s.background);
    return { working: running.filter((s) => s.state === "working").length, subagents: running.reduce((n, s) => n + liveSubagents(s, now), 0) };
}

// The state a session shows as: one whose turn ended while its subagents still run is at work.
export const shownState = (s: Session, now: number): Session["state"] => (s.state !== "ended" && liveSubagents(s, now) ? "working" : s.state);
