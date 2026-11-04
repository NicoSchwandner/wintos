import { describe, expect, test } from "vitest";
import { addTime, mergeBackfill, monthByEpic, TICK_CAP_MS } from "./time";

describe("addTime", () => {
    test("adds to the session's day", () => {
        const log = addTime(addTime({}, "2026-11-04", "s1", "route", 30_000), "2026-11-04", "s1", "route", 30_000);
        expect(log).toEqual({ "2026-11-04": { s1: { epic: "route", ms: 60_000 } } });
    });
    test("a long gap (the Mac asleep) adds no more than one capped tick", () => expect(addTime({}, "d", "s1", "route", 3_600_000).d.s1.ms).toBe(TICK_CAP_MS));
    test("nothing to add leaves the log as it was", () => {
        const log = {};
        expect(addTime(log, "d", "s1", "route", 0)).toBe(log);
    });
    test("a session without an epic yet keeps one it had earlier that day", () => expect(addTime({ d: { s1: { epic: "route", ms: 10 } } }, "d", "s1", undefined, 10).d.s1).toEqual({ epic: "route", ms: 20 }));
});

describe("monthByEpic", () => {
    const log = {
        "2026-10-31": { s0: { epic: "route", ms: 999 } },
        "2026-11-03": { s1: { epic: "route", ms: 60_000 }, s2: { epic: "reviews", ms: 30_000 } },
        "2026-11-04": { s1: { epic: "route", ms: 60_000 }, s3: { ms: 10_000 } },
    };
    test("sums one month by epic, most time first, with sessions and days", () =>
        expect(monthByEpic(log, "2026-11")).toEqual([
            { epic: "route", ms: 120_000, sessions: 1, days: 2 },
            { epic: "reviews", ms: 30_000, sessions: 1, days: 1 },
            { epic: undefined, ms: 10_000, sessions: 1, days: 1 },
        ]));
    test("a month with nothing logged is empty", () => expect(monthByEpic(log, "2026-12")).toEqual([]));
});

describe("mergeBackfill", () => {
    test("adds the estimated sessions; one already logged keeps its own time", () =>
        expect(mergeBackfill({ d1: { s1: { epic: "a", ms: 5 } } }, { d1: { s1: { epic: "b", ms: 99 }, s2: { ms: 7 } }, d0: { s3: { epic: "a", ms: 3 } } })).toEqual({
            d1: { s1: { epic: "a", ms: 5 }, s2: { ms: 7 } },
            d0: { s3: { epic: "a", ms: 3 } },
        }));
});
