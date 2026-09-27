import type { Session } from "../sessions/reduce";

export type Band = "needs" | "running" | "quiet";
export type Row = { tabId: string; band: Band; lastAt: number; sessions: Session[]; waitingSince?: number };
export type Ranking = { needs: Row[]; running: Row[]; quiet: Row[]; quietMore: Row[]; quietStale: string[] };

export const QUIET_CAP = 6;
export const STALE_MS = 14 * 86_400_000;

export function rank(tabIds: string[], sessions: Session[], now: number, touched: Record<string, number> = {}): Ranking {
    const rows = tabIds.map((tabId) => rowOf(tabId, sessions.filter((s) => s.tabId === tabId), touched[tabId] ?? 0));
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
        quietStale: quietAll.filter(isStale).map((r) => r.tabId),
    };
}

function rowOf(tabId: string, sessions: Session[], touchedAt: number): Row {
    const lastAt = Math.max(touchedAt, ...sessions.map((s) => s.lastAt), 0);
    const waiting = sessions.filter((s) => s.state === "waiting");
    if (waiting.length) return { tabId, band: "needs", lastAt, sessions, waitingSince: Math.min(...waiting.map((s) => s.since)) };
    if (sessions.some((s) => s.state === "working")) return { tabId, band: "running", lastAt, sessions };
    return { tabId, band: "quiet", lastAt, sessions };
}
