// The hold: a turn that came to wait on you while you were on a break, in a focus block on
// another project, or since the last batch boundary, shows in Your move only later, so you
// answer in batches rather than as each one comes in. The project you are in is never held.
// batchEveryMs: WINTOS_BATCH_EVERY; boundaries are on the clock (:00, :20, :40 for 20 minutes).
// releasedAt: ⌥⌘O opened the batch then. breakFrom: the break going on now began then.
// quietUntil: the day was closed; everything waits for the next workday.
export type HoldContext = { now: number; batchEveryMs: number; releasedAt?: number; breakFrom?: number; focus?: { tabId: string; from: number; until: number }; here?: string; quietUntil?: number };

// When the row shows in Your move; undefined: now. Infinity: when the break ends.
export function heldUntil(row: { tabId: string; waitingSince: number }, c: HoldContext): number | undefined {
    if (row.tabId === c.here) return undefined;
    const t = row.waitingSince;
    let until = 0;
    if (c.batchEveryMs && !(c.releasedAt !== undefined && t <= c.releasedAt)) until = Math.ceil(t / c.batchEveryMs) * c.batchEveryMs;
    if (c.breakFrom !== undefined && t >= c.breakFrom) until = Infinity;
    const f = c.focus;
    if (f && c.now < f.until && row.tabId !== f.tabId && t >= f.from) until = Math.max(until, f.until);
    if (c.quietUntil !== undefined && c.now < c.quietUntil) until = Math.max(until, c.quietUntil);
    return until > c.now ? until : undefined;
}
