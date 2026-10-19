import type { Session } from "../sessions/reduce";

// needs: your move, a turn waiting on you. read: a reply to read, nothing asked of you.
export type Band = "needs" | "read" | "running" | "quiet";
// unread: a turn ended after the developer last saw the project; it needs them until they do.
// waitingSince: when the oldest need began (the band's order).
export type Row = { tabId: string; band: Band; lastAt: number; sessions: Session[]; waitingSince?: number; unread?: boolean };
export type Ranking = { needs: Row[]; read: Row[]; running: Row[]; quiet: Row[]; quietMore: Row[]; quietStale: Row[] };

export const QUIET_CAP = 6;

// seen holds when the developer last looked at each session (or, from before that, its project).
// A parked turn is a reply too: it goes quiet once you have read how it ended.
export const isUnread = (s: Session, seen: Record<string, number>) => s.state !== "ended" && (s.turnEndedAt ?? 0) > (seen[s.id] ?? seen[s.tabId] ?? 0);
export const STALE_MS = 14 * 86_400_000;

// seen: when the developer last looked at each session; a reply after that is unread.
// Only sessions put a project in Your move (a turn waiting on you) or To read (a reply you haven't
// read). A PR that needs you is the PRs tab's to show.
export function rank(tabIds: string[], sessions: Session[], now: number, touched: Record<string, number> = {}, seen: Record<string, number> = {}): Ranking {
    const rows = tabIds.map((tabId) => rowOf(tabId, sessions.filter((s) => s.tabId === tabId), touched[tabId] ?? 0, seen));
    const byRecent = (a: Row, b: Row) => b.lastAt - a.lastAt;
    const byWait = (a: Row, b: Row) => a.waitingSince! - b.waitingSince!;
    const quietAll = rows.filter((r) => r.band === "quiet").sort(byRecent);
    // lastAt 0 means nothing is known yet (a fresh tab), which is not the same as untouched.
    const isStale = (r: Row) => r.lastAt > 0 && now - r.lastAt > STALE_MS;
    const quietLive = quietAll.filter((r) => !isStale(r));
    return {
        needs: rows.filter((r) => r.band === "needs").sort(byWait),
        read: rows.filter((r) => r.band === "read").sort(byWait),
        running: rows.filter((r) => r.band === "running").sort(byRecent),
        quiet: quietLive.slice(0, QUIET_CAP),
        quietMore: quietLive.slice(QUIET_CAP),
        quietStale: quietAll.filter(isStale),
    };
}

function rowOf(tabId: string, sessions: Session[], touchedAt: number, seen: Record<string, number>): Row {
    const lastAt = Math.max(touchedAt, ...sessions.map((s) => s.lastAt), 0);
    const unreadAt = sessions.filter((s) => isUnread(s, seen)).map((s) => s.turnEndedAt!);
    const waiting = sessions.filter((s) => s.state === "waiting").map((s) => s.since);
    const unread = unreadAt.length ? { unread: true } : {};
    if (waiting.length) return { tabId, band: "needs", lastAt, sessions, waitingSince: Math.min(...waiting, ...unreadAt), ...unread };
    if (unreadAt.length) return { tabId, band: "read", lastAt, sessions, waitingSince: Math.min(...unreadAt), ...unread };
    // Running is Claude at work. Parked waits on something outside (a review, CI): nothing for you
    // and nothing running, so it is quiet, its row saying what it waits on.
    if (sessions.some((s) => s.state === "working")) return { tabId, band: "running", lastAt, sessions };
    return { tabId, band: "quiet", lastAt, sessions };
}
