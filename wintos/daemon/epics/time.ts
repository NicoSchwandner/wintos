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
            if (!sid.startsWith(`${ADJUST}:`)) e.sessions.add(sid);
            e.days.add(day);
            by.set(epic, e);
        }
    }
    return [...by].map(([epic, e]) => ({ epic, ms: e.ms, sessions: e.sessions.size, days: e.days.size })).sort((a, b) => b.ms - a.ms);
}

// Time estimated for days before logging began (from the session transcripts): a session the
// log already has keeps what was counted, so a backfill never doubles or overrides it.
export function mergeBackfill(log: TimeLog, backfill: TimeLog): TimeLog {
    const out: TimeLog = { ...log };
    for (const [day, sessions] of Object.entries(backfill))
        for (const [sid, entry] of Object.entries(sessions)) if (!out[day]?.[sid] && entry.ms > 0) out[day] = { ...out[day], [sid]: entry };
    return out;
}

// An epic's own history from the log: its time per day (the last `days` days logged), and each
// session that worked in it with its total, newest first.
export type EpicHistory = { days: { day: string; ms: number }[]; sessions: { sessionId: string; ms: number; last: string }[] };
export function epicHistory(log: TimeLog, epic: string, days: string[]): EpicHistory {
    const per = new Map<string, { ms: number; last: string }>();
    for (const [day, sessions] of Object.entries(log))
        for (const [sid, e] of Object.entries(sessions)) {
            if (e.epic !== epic) continue;
            const was = per.get(sid) ?? { ms: 0, last: "" };
            per.set(sid, { ms: was.ms + e.ms, last: day > was.last ? day : was.last });
        }
    return {
        days: days.map((day) => ({ day, ms: Object.values(log[day] ?? {}).filter((e) => e.epic === epic).reduce((n, e) => n + e.ms, 0) })),
        sessions: [...per].map(([sessionId, v]) => ({ sessionId, ...v })).sort((a, b) => b.last.localeCompare(a.last) || b.ms - a.ms),
    };
}

// The last n workdays up to today, oldest first, as YYYY-MM-DD.
export function lastWorkdays(today: Date, n: number): string[] {
    const out: string[] = [];
    for (const d = new Date(today); out.length < n; d.setDate(d.getDate() - 1))
        if (d.getDay() !== 0 && d.getDay() !== 6) out.unshift(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    return out;
}

// A correction to a month's time for one epic (the report's "correct"), kept as its own entry
// on the month's first day, so the logged time stays as it was measured.
export const ADJUST = "adjust";
export function adjustMonth(log: TimeLog, month: string, epic: string | undefined, ms: number): TimeLog {
    const day = `${month}-01`;
    const key = `${ADJUST}:${epic ?? "none"}`;
    const { [key]: _, ...rest } = log[day] ?? {};
    return { ...log, [day]: ms ? { ...rest, [key]: { ...(epic ? { epic } : {}), ms } } : rest };
}
