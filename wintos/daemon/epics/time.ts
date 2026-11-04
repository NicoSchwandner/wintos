// Time at each epic, for the month's project reporting: a minute counts when you were at one of
// its sessions, its pane focused in WintOS and your Mac not idle. A session working on its own
// while you were elsewhere is not your time.
// day → session → { epic it was in, ms }. Kept by session so moving one to another epic later
// doesn't rewrite the past.
export type TimeLog = Record<string, Record<string, { epic?: string; ms: number }>>;

// The idle tick comes every 30 s; a gap longer than this (the Mac asleep) adds no more than it.
export const TICK_CAP_MS = 60_000;

export function addTime(log: TimeLog, day: string, sessionId: string, epic: string | undefined, ms: number): TimeLog {
    if (ms <= 0) return log;
    const was = log[day]?.[sessionId];
    const entry = { ...(epic ? { epic } : was?.epic ? { epic: was.epic } : {}), ms: (was?.ms ?? 0) + Math.min(ms, TICK_CAP_MS) };
    return { ...log, [day]: { ...log[day], [sessionId]: entry } };
}

export type EpicTime = { epic: string | undefined; ms: number; sessions: number; days: number };

// One month (YYYY-MM), by epic, most time first. A session with no epic counts under undefined.
export function monthByEpic(log: TimeLog, month: string): EpicTime[] {
    const by = new Map<string | undefined, { ms: number; sessions: Set<string>; days: Set<string> }>();
    for (const [day, sessions] of Object.entries(log)) {
        if (!day.startsWith(`${month}-`)) continue;
        for (const [sid, { epic, ms }] of Object.entries(sessions)) {
            const e = by.get(epic) ?? { ms: 0, sessions: new Set(), days: new Set() };
            e.ms += ms;
            e.sessions.add(sid);
            e.days.add(day);
            by.set(epic, e);
        }
    }
    return [...by].map(([epic, e]) => ({ epic, ms: e.ms, sessions: e.sessions.size, days: e.days.size })).sort((a, b) => b.ms - a.ms);
}
