import { RANKS, type KeyStats } from "../daemon/keyboard/keyboard";

// What the Keyboard page shows, from the score wintosd keeps.
export function progress(s: KeyStats): { rank: string; next?: string; points: number; toNext: number; pct: number } {
    const [rank, from] = RANKS[s.rank];
    const next = RANKS[s.rank + 1];
    if (!next) return { rank, points: s.points, toNext: 0, pct: 100 };
    return { rank, next: next[0], points: s.points, toNext: Math.max(0, next[1] - s.points), pct: Math.round((Math.max(0, s.points - from) / (next[1] - from)) * 100) };
}

const TIERS: [number, "bronze" | "silver" | "gold"][] = [[200, "gold"], [50, "silver"], [10, "bronze"]];
export function badges(s: KeyStats): { key: string; count: number; tier: "bronze" | "silver" | "gold"; next?: number }[] {
    return Object.entries(s.keys)
        .flatMap(([key, count]) => {
            const i = TIERS.findIndex(([n]) => count >= n);
            if (i < 0) return [];
            return [{ key, count, tier: TIERS[i][1], ...(i > 0 ? { next: TIERS[i - 1][0] } : {}) }];
        })
        .sort((a, b) => b.count - a.count);
}

// A key card row ("⌘J / ⌘K", "walk") counts as used if any of its keys was.
export function neverUsed(sections: [string, [string, string][]][], s: KeyStats): [string, string][] {
    return sections.flatMap(([, rows]) => rows).filter(([keys]) => !keys.split(/\s*[\/·]\s*/).some((k) => (s.keys[k.trim()] ?? 0) > 0));
}

export function week(s: KeyStats, now: number): { date: string; keys: number; clicks: number }[] {
    return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(now);
        d.setDate(d.getDate() - 6 + i);
        const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        return { date, ...(s.days[date] ?? { keys: 0, clicks: 0 }) };
    });
}
