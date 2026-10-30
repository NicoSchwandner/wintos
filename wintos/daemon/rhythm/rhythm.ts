// The day's rhythm: how long you have been at it since your last break, and the breaks you took.
// It reads the Mac's idle time (any key or move, in WintOS or not), so walking away counts.

export type Break = { start: number; end: number };
// stretchFrom: your first input after the last break. awayFrom: your last input before an idle
// run that is long enough to be a break. onBreak: when ⌥⌘B started one.
// lastPrompt: the last prompt you sent, by its length only. releasedAt: ⌥⌘O opened the batch.
// focus: a focus block (⌥⌘F) on one project (hold.ts). closed: the day you closed (⇧⌘E), quiet
// until the next workday starts.
export type Rhythm = { day: string; stretchFrom: number; breaks: Break[]; awayFrom?: number; onBreak?: number; snoozedUntil?: number; lastPrompt?: { at: number; chars: number }; releasedAt?: number; focus?: { tabId: string; from: number; until: number }; closed?: { day: string; until: number } };
export type Nudge = { kind: "move" | "dispatch" | "lunch" | "wrap"; minutes: number };

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
    const x: Rhythm = r.day === day ? r : { day, stretchFrom: lastInput, breaks: [], ...(r.closed && r.closed.until > now ? { closed: r.closed } : {}) };
    if (idleMs >= AWAY_MS) return x.awayFrom === undefined ? { ...x, awayFrom: lastInput } : x;
    const from = x.onBreak !== undefined ? Math.min(x.onBreak, x.awayFrom ?? Infinity) : x.awayFrom;
    const { awayFrom: _a, onBreak: _b, ...rest } = x;
    if (from !== undefined && lastInput - from >= AWAY_MS) return { ...rest, stretchFrom: lastInput, breaks: [...x.breaks, { start: from, end: lastInput }] };
    if (x.onBreak !== undefined && lastInput <= x.onBreak + BREAK_GRACE_MS) return x.awayFrom === undefined ? x : { ...rest, onBreak: x.onBreak };
    return x.awayFrom === undefined && x.onBreak === undefined ? x : rest;
}

export const startBreak = (r: Rhythm, now: number): Rhythm => ({ ...r, onBreak: now });
export const snooze = (r: Rhythm, now: number, minutes: number): Rhythm => ({ ...r, snoozedUntil: now + minutes * 60_000 });
export const release = (r: Rhythm, now: number): Rhythm => ({ ...r, releasedAt: now });
export const FOCUS_MS = 45 * 60_000;
// ⌥⌘F on the project it is on starts a block, again ends it; on another project it moves there.
export function toggleFocus(r: Rhythm, tabId: string, now: number): Rhythm {
    const { focus, ...rest } = r;
    if (focus && focus.tabId === tabId && now < focus.until) return rest;
    return { ...rest, focus: { tabId, from: now, until: now + FOCUS_MS } };
}
// ⇧⌘E then ⌘⏎: the day is done, quiet until the next workday starts (a Friday's until Monday's).
export function closeDay(r: Rhythm, now: Date, startMinutes: number): Rhythm {
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, startMinutes);
    while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
    return { ...r, closed: { day: r.day, until: next.getTime() } };
}
export const prompted = (r: Rhythm, at: number, chars: number): Rhythm => ({ ...r, lastPrompt: { at, chars } });

// The nudge to show now, if any. Only at a natural pause: nothing waits on you.
// lunch: the lunch window in minutes of the day (WINTOS_LUNCH), today: the day it is on.
// workday: in minutes of the day (WINTOS_WORKDAY); past its end, closing the day is asked, needs or not.
export function nudge(r: Rhythm, c: { now: number; everyMs: number; needs: number; working: number; live: number; lunch?: [number, number]; workday?: [number, number]; today?: Date }): Nudge | undefined {
    const { now } = c;
    if ((r.closed && now < r.closed.until) || r.onBreak !== undefined || r.awayFrom !== undefined || (r.snoozedUntil ?? 0) > now) return undefined;
    const at = now - r.stretchFrom;
    const minutes = Math.round(at / 60_000);
    const mid = c.today && new Date(c.today.getFullYear(), c.today.getMonth(), c.today.getDate()).getTime();
    if (c.workday && mid !== undefined && now >= mid + c.workday[1] * 60_000) return { kind: "wrap", minutes };
    if (!c.everyMs || c.needs > 0) return undefined;
    if (c.lunch && mid !== undefined) {
        const [from, to] = [mid + c.lunch[0] * 60_000, mid + c.lunch[1] * 60_000];
        const ate = r.breaks.some((b) => b.end - b.start >= LUNCH_MS && b.end > from);
        if (!ate && now >= to && now < to + LUNCH_ASKS_FOR_MS) return { kind: "lunch", minutes };
    }
    const p = r.lastPrompt;
    if (p && now - p.at < DISPATCH_WITHIN_MS && p.chars >= DISPATCH_CHARS && c.live > 0 && c.working === c.live && at >= DISPATCH_AFTER_MS) return { kind: "dispatch", minutes };
    if (at >= c.everyMs) return { kind: "move", minutes };
    return undefined;
}
