import type { Session } from "../sessions/reduce";

export type Band = "needs" | "running" | "quiet";
// unread: a turn ended after the developer last saw the project; it needs them until they do.
export type Row = { tabId: string; band: Band; lastAt: number; sessions: Session[]; waitingSince?: number; unread?: boolean };
export type Ranking = { needs: Row[]; running: Row[]; quiet: Row[]; quietMore: Row[]; quietStale: Row[] };

export const QUIET_CAP = 6;

export const isUnread = (s: Session, seenAt: number) => s.state !== "ended" && (s.turnEndedAt ?? 0) > seenAt;
export const STALE_MS = 14 * 86_400_000;

// prBlocked: tabs whose project has a PR in Fix or Chase, with when that started (spec §3.3).
// seen: when the developer last looked at each project; a reply after that is unread.
export function rank(tabIds: string[], sessions: Session[], now: number, touched: Record<string, number> = {}, prBlocked: Record<string, number> = {}, seen: Record<string, number> = {}): Ranking {
    const rows = tabIds.map((tabId) => rowOf(tabId, sessions.filter((s) => s.tabId === tabId), touched[tabId] ?? 0, prBlocked[tabId], seen[tabId] ?? 0));
    const byRecent = (a: Row, b: Row) => b.lastAt - a.lastAt;
    const quietAll = rows.filter((r) => r.band === "quiet").sort(byRecent);
    // lastAt 0 means nothing is known yet (a fresh tab), which is not the same as untouched.
    const isStale = (r: Row) => r.lastAt > 0 && now - r.lastAt > STALE_MS;
    const quietLive = quietAll.filter((r) => !isStale(r));
    return {
        needs: rows.filter((r) => r.band === "needs").sort((a, b) => a.waitingSince! - b.waitingSince!),
        running: rows.filter((r) => r.band === "running").sort(byRecent),
        quiet: quietLive.slice(0, QUIET_CAP),
        quietMore: quietLive.slice(QUIET_CAP),
        quietStale: quietAll.filter(isStale),
    };
}

function rowOf(tabId: string, sessions: Session[], touchedAt: number, prBlockedSince: number | undefined, seenAt: number): Row {
    const lastAt = Math.max(touchedAt, ...sessions.map((s) => s.lastAt), 0);
    const unreadAt = sessions.filter((s) => isUnread(s, seenAt)).map((s) => s.turnEndedAt!);
    const since = [...sessions.filter((s) => s.state === "waiting").map((s) => s.since), ...(prBlockedSince !== undefined ? [prBlockedSince] : []), ...unreadAt];
    if (since.length) return { tabId, band: "needs", lastAt, sessions, waitingSince: Math.min(...since), ...(unreadAt.length ? { unread: true } : {}) };
    if (sessions.some((s) => s.state === "working" || s.state === "parked")) return { tabId, band: "running", lastAt, sessions };
    return { tabId, band: "quiet", lastAt, sessions };
}
