// The hold: a turn that came to wait on you while you were on a break shows in Your move only
// once you are back. The project you are in is never held.
// breakFrom: the break going on now began then.
export type HoldContext = { breakFrom?: number; here?: string };

export const isHeld = (row: { tabId: string; waitingSince: number }, c: HoldContext): boolean =>
    row.tabId !== c.here && c.breakFrom !== undefined && row.waitingSince >= c.breakFrom;
