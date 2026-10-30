// The day's rhythm: how long you have been at it since your last break, and the breaks you took.
// It reads the Mac's idle time (any key or move, in WintOS or not), so walking away counts.

export type Break = { start: number; end: number };
// stretchFrom: your first input after the last break. awayFrom: your last input before an idle
// run that is long enough to be a break. onBreak: when ⌥⌘B started one.
// lastPrompt: the last prompt you sent, by its length only.
export type Rhythm = { day: string; stretchFrom: number; breaks: Break[]; awayFrom?: number; onBreak?: number; snoozedUntil?: number; lastPrompt?: { at: number; chars: number } };
export type Nudge = { kind: "move" | "dispatch" | "lunch"; minutes: number };

export const AWAY_MS = 2 * 60_000;
// You pressed ⌥⌘B but kept on: past this, the break is off.
const BREAK_GRACE_MS = 30_000;
const DISPATCH_CHARS = 300;
const DISPATCH_WITHIN_MS = 90_000;
const DISPATCH_AFTER_MS = 15 * 60_000;
const LUNCH_MS = 20 * 60_000;
const LUNCH_ASKS_FOR_MS = 2 * 3_600_000;

export function tick(r: Rhythm, idleMs: number, now: number, day: string): Rhythm {
    const lastInput = now - idleMs;
    const x: Rhythm = r.day === day ? r : { day, stretchFrom: lastInput, breaks: [] };
    if (idleMs >= AWAY_MS) return x.awayFrom === undefined ? { ...x, awayFrom: lastInput } : x;
    const from = x.onBreak !== undefined ? Math.min(x.onBreak, x.awayFrom ?? Infinity) : x.awayFrom;
    const { awayFrom: _a, onBreak: _b, ...rest } = x;
    if (from !== undefined && lastInput - from >= AWAY_MS) return { ...rest, stretchFrom: lastInput, breaks: [...x.breaks, { start: from, end: lastInput }] };
    if (x.onBreak !== undefined && lastInput <= x.onBreak + BREAK_GRACE_MS) return x.awayFrom === undefined ? x : { ...rest, onBreak: x.onBreak };
    return x.awayFrom === undefined && x.onBreak === undefined ? x : rest;
}

export const startBreak = (r: Rhythm, now: number): Rhythm => ({ ...r, onBreak: now });
export const snooze = (r: Rhythm, now: number, minutes: number): Rhythm => ({ ...r, snoozedUntil: now + minutes * 60_000 });
export const prompted = (r: Rhythm, at: number, chars: number): Rhythm => ({ ...r, lastPrompt: { at, chars } });

// The nudge to show now, if any. Only at a natural pause: nothing waits on you.
// lunch: the lunch window in minutes of the day (WINTOS_LUNCH), today: the day it is on.
export function nudge(r: Rhythm, c: { now: number; everyMs: number; needs: number; working: number; live: number; lunch?: [number, number]; today?: Date }): Nudge | undefined {
    const { now } = c;
    if (!c.everyMs || r.onBreak !== undefined || r.awayFrom !== undefined || (r.snoozedUntil ?? 0) > now || c.needs > 0) return undefined;
    const at = now - r.stretchFrom;
    const minutes = Math.round(at / 60_000);
    if (c.lunch && c.today) {
        const mid = new Date(c.today.getFullYear(), c.today.getMonth(), c.today.getDate()).getTime();
        const [from, to] = [mid + c.lunch[0] * 60_000, mid + c.lunch[1] * 60_000];
        const ate = r.breaks.some((b) => b.end - b.start >= LUNCH_MS && b.end > from);
        if (!ate && now >= to && now < to + LUNCH_ASKS_FOR_MS) return { kind: "lunch", minutes };
    }
    const p = r.lastPrompt;
    if (p && now - p.at < DISPATCH_WITHIN_MS && p.chars >= DISPATCH_CHARS && c.live > 0 && c.working === c.live && at >= DISPATCH_AFTER_MS) return { kind: "dispatch", minutes };
    if (at >= c.everyMs) return { kind: "move", minutes };
    return undefined;
}
