// The hold: a turn that came to wait on you while you were on a break shows in Your move only
// once you are back. The project you are in is never held.
// breakFrom: the break going on now began then.
// quietUntil: the day was closed; everything waits for the next workday.
export type HoldContext = { now: number; breakFrom?: number; here?: string; quietUntil?: number };

// When the row shows in Your move; undefined: now. Infinity: when the break ends.
export function heldUntil(row: { tabId: string; waitingSince: number }, c: HoldContext): number | undefined {
    if (row.tabId === c.here) return undefined;
    const t = row.waitingSince;
    let until = 0;
    if (c.breakFrom !== undefined && t >= c.breakFrom) until = Infinity;
    if (c.quietUntil !== undefined && c.now < c.quietUntil) until = Math.max(until, c.quietUntil);
    return until > c.now ? until : undefined;
}
