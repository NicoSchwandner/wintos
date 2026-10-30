import { describe, expect, test } from "vitest";
import { AWAY_MS, FOCUS_MS, nudge, prompted, startBreak, snooze, tick, toggleFocus, type Rhythm } from "./rhythm";

const MIN = 60_000;
const T0 = 1_000 * MIN;
const fresh: Rhythm = { day: "d1", stretchFrom: T0, breaks: [] };
const calm = { needs: 0, working: 2, live: 2, everyMs: 30 * MIN };

describe("tick", () => {
    test("idle past AWAY_MS is a break once input comes back; the stretch starts again there", () => {
        let r = tick(fresh, 0, T0 + 10 * MIN, "d1");
        r = tick(r, AWAY_MS + MIN, T0 + 13 * MIN, "d1");
        expect(r.awayFrom).toBe(T0 + 10 * MIN);
        r = tick(r, 5_000, T0 + 15 * MIN, "d1");
        expect(r).toMatchObject({ stretchFrom: T0 + 15 * MIN - 5_000, breaks: [{ start: T0 + 10 * MIN, end: T0 + 15 * MIN - 5_000 }] });
        expect(r.awayFrom).toBeUndefined();
    });

    test("a short pause is no break", () => {
        const r = tick(tick(fresh, MIN, T0 + 5 * MIN, "d1"), 0, T0 + 6 * MIN, "d1");
        expect(r).toEqual(fresh);
    });

    test("a new day starts a new stretch with no breaks", () =>
        expect(tick({ ...fresh, breaks: [{ start: 1, end: 2 }] }, 0, T0 + 600 * MIN, "d2")).toEqual({ day: "d2", stretchFrom: T0 + 600 * MIN, breaks: [] }));

    test("a break taken with ⌥⌘B counts from the key, and ends when you are back", () => {
        let r = startBreak(fresh, T0 + 30 * MIN);
        r = tick(r, 30_000, T0 + 30 * MIN + 30_000, "d1");
        expect(r.onBreak).toBe(T0 + 30 * MIN);
        r = tick(r, 0, T0 + 34 * MIN, "d1");
        expect(r).toMatchObject({ breaks: [{ start: T0 + 30 * MIN, end: T0 + 34 * MIN }], stretchFrom: T0 + 34 * MIN });
        expect(r.onBreak).toBeUndefined();
    });

    test("⌥⌘B and then working on is no break: it ends without one", () => {
        const r = tick(startBreak(fresh, T0 + 30 * MIN), 0, T0 + 31 * MIN, "d1");
        expect(r.onBreak).toBeUndefined();
        expect(r.breaks).toEqual([]);
    });
});

describe("nudge", () => {
    test("after the stretch, at a moment nothing needs you", () => {
        expect(nudge(fresh, { ...calm, now: T0 + 29 * MIN })).toBeUndefined();
        expect(nudge(fresh, { ...calm, now: T0 + 31 * MIN })).toEqual({ kind: "move", minutes: 31 });
        expect(nudge(fresh, { ...calm, needs: 1, now: T0 + 40 * MIN })).toBeUndefined();
    });

    test("not while away, on a break, snoozed, or turned off", () => {
        const now = T0 + 40 * MIN;
        expect(nudge({ ...fresh, awayFrom: now - MIN }, { ...calm, now })).toBeUndefined();
        expect(nudge(startBreak(fresh, now), { ...calm, now })).toBeUndefined();
        expect(nudge(snooze(fresh, now, 10), { ...calm, now: now + 9 * MIN })).toBeUndefined();
        expect(nudge(snooze(fresh, now, 10), { ...calm, now: now + 11 * MIN })).toMatchObject({ kind: "move" });
        expect(nudge(fresh, { ...calm, everyMs: 0, now })).toBeUndefined();
    });

    test("a long task just sent with every session at work: step away now", () => {
        const now = T0 + 20 * MIN;
        const r = prompted(fresh, now - 30_000, 420);
        expect(nudge(r, { ...calm, now })).toEqual({ kind: "dispatch", minutes: 20 });
        expect(nudge(r, { ...calm, working: 1, now })).toBeUndefined();
        expect(nudge(prompted(fresh, now - 30_000, 80), { ...calm, now })).toBeUndefined();
        expect(nudge(r, { ...calm, now: T0 + 10 * MIN })).toBeUndefined();
    });

    test("lunch: past the window with no 20-minute break in it", () => {
        const day = new Date(2026, 9, 30);
        const at = (h: number, m = 0) => new Date(2026, 9, 30, h, m).getTime();
        const lunch: [number, number] = [11 * 60 + 30, 13 * 60];
        const r: Rhythm = { day: "d1", stretchFrom: at(12, 50), breaks: [] };
        expect(nudge(r, { ...calm, now: at(13, 5), lunch, today: day })).toEqual({ kind: "lunch", minutes: 15 });
        expect(nudge({ ...r, breaks: [{ start: at(12, 0), end: at(12, 25) }] }, { ...calm, now: at(13, 5), lunch, today: day })).toBeUndefined();
        expect(nudge(r, { ...calm, now: at(12, 55), lunch, today: day })).toBeUndefined();
    });
});

test("⌥⌘F starts a 45-minute focus block on the project, again ends it, elsewhere moves it", () => {
    const r = toggleFocus(fresh, "a", T0);
    expect(r.focus).toEqual({ tabId: "a", from: T0, until: T0 + FOCUS_MS });
    expect(toggleFocus(r, "a", T0 + MIN).focus).toBeUndefined();
    expect(toggleFocus(r, "b", T0 + MIN).focus).toMatchObject({ tabId: "b", from: T0 + MIN });
    expect(toggleFocus(r, "a", T0 + FOCUS_MS + MIN).focus).toMatchObject({ tabId: "a", from: T0 + FOCUS_MS + MIN });
});
