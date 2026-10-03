// The keyboard game: WintOS actions done by key score, a click on something that has a key is a
// slip. Ranks rise as soon as the points reach them and only fall when a week ends below them,
// so one click never costs a rank. Each key earns its own badge with use.
export const RANKS: [string, number][] = [["Tourist", 0], ["Commuter", 100], ["Fluent", 300], ["Mouse-free", 600], ["Monk", 1500]];
const SLIP_COST = [1, 3, 8, 15, 25]; // by rank: a slip costs more the further you've come
const CLEAN_DAY = 20;
const TIERS: [number, Badge["tier"]][] = [[200, "gold"], [50, "silver"], [10, "bronze"]];
const DAYS_KEPT = 60;

export type Badge = { key: string; tier: "bronze" | "silver" | "gold"; at: number };
export type KeyStats = {
    points: number;
    rank: number;
    streak: number;
    best: number;
    keys: Record<string, number>;
    clicks: Record<string, number>;
    days: Record<string, { keys: number; clicks: number }>;
    lastDay?: string;
    badge?: Badge; // the newest, for the sidebar to announce once
};

export const emptyStats = (): KeyStats => ({ points: 0, rank: 0, streak: 0, best: 0, keys: {}, clicks: {}, days: {} });
export const rankOf = (s: KeyStats) => RANKS[s.rank][0];
const rankFor = (points: number) => RANKS.reduce((r, [, at], i) => (points >= at ? i : r), 0);

const isoDay = (t: number) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
// The Monday of the day's week, as a day.
const weekOf = (iso: string) => {
    const d = new Date(`${iso}T12:00:00`);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return isoDay(d.getTime());
};

// A new day settles the last one: a clean day's bonus, and at a new week the rank is set to what
// the points earn, which is the only way it falls.
function rollOver(s: KeyStats, now: number): KeyStats {
    const today = isoDay(now);
    if (!s.lastDay || s.lastDay === today) return { ...s, lastDay: today, days: { ...s.days, [today]: s.days[today] ?? { keys: 0, clicks: 0 } } };
    const last = s.days[s.lastDay];
    const points = s.points + (last && last.keys > 0 && last.clicks === 0 ? CLEAN_DAY : 0);
    const rank = weekOf(s.lastDay) !== weekOf(today) ? rankFor(points) : s.rank;
    const days = Object.fromEntries(Object.entries({ ...s.days, [today]: { keys: 0, clicks: 0 } }).sort().slice(-DAYS_KEPT));
    return { ...s, points, rank, lastDay: today, days };
}

export function recordKey(stats: KeyStats, key: string, now: number): KeyStats {
    const s = rollOver(stats, now);
    const day = s.lastDay!;
    const used = (s.keys[key] ?? 0) + 1;
    const points = s.points + 1;
    const tier = TIERS.find(([n]) => n === used)?.[1];
    return {
        ...s,
        points,
        rank: Math.max(s.rank, rankFor(points)),
        streak: s.streak + 1,
        best: Math.max(s.best, s.streak + 1),
        keys: { ...s.keys, [key]: used },
        days: { ...s.days, [day]: { ...s.days[day], keys: s.days[day].keys + 1 } },
        ...(tier ? { badge: { key, tier, at: now } } : {}),
    };
}

export function recordClick(stats: KeyStats, key: string, now: number): KeyStats {
    const s = rollOver(stats, now);
    const day = s.lastDay!;
    return {
        ...s,
        points: Math.max(0, s.points - SLIP_COST[s.rank]),
        streak: 0,
        clicks: { ...s.clicks, [key]: (s.clicks[key] ?? 0) + 1 },
        days: { ...s.days, [day]: { ...s.days[day], clicks: s.days[day].clicks + 1 } },
    };
}
