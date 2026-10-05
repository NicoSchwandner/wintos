import { describe, expect, test } from "vitest";
import { emptyStats, rankOf, recordClick, recordDayDone, recordKey, RANKS, type KeyStats } from "./keyboard";

const day = (d: number, h = 10) => new Date(2026, 9, d, h).getTime(); // October 2026; the 5th is a Monday
const keys = (s: KeyStats, n: number, key = "⌘J", at = day(5)) => Array.from({ length: n }).reduce<KeyStats>((x) => recordKey(x, key, at), s);

describe("points and the streak", () => {
    test("a key action scores a point and grows the streak", () => {
        const s = keys(emptyStats(), 3);
        expect([s.points, s.streak, s.keys["⌘J"], s.days["2026-10-05"]]).toEqual([3, 3, 3, { keys: 3, clicks: 0 }]);
    });

    test("a slip ends the streak and costs what the rank says", () => {
        const s = recordClick({ ...keys(emptyStats(), 5), rank: 2, points: 400 }, "⌘J", day(5));
        expect([s.streak, s.points, s.clicks["⌘J"], s.days["2026-10-05"].clicks, s.best]).toEqual([0, 400 - 8, 1, 1, 5]);
    });

    test("points never go below zero", () => expect(recordClick(emptyStats(), "⌘J", day(5)).points).toBe(0));

    test("a clean day earns 20 when the next day starts", () => {
        const s = recordKey(keys(emptyStats(), 4, "⌘J", day(5)), "⌘J", day(6));
        expect(s.points).toBe(4 + 20 + 1);
    });

    test("a day with a slip earns no bonus", () => {
        const s = recordKey(recordClick(keys(emptyStats(), 4, "⌘J", day(5)), "⌘J", day(5)), "⌘J", day(6));
        expect(s.points).toBe(4 - 1 + 1);
    });
});

describe("ranks", () => {
    test("the thresholds", () => expect(RANKS.map(([n, at]) => `${n} ${at}`)).toEqual(["Tourist 0", "Commuter 100", "Fluent 300", "Mouse-free 600", "Monk 1500"]));

    test("a rank rises as soon as the points reach it", () => {
        const s = keys({ ...emptyStats(), points: 99 }, 1);
        expect(rankOf(s)).toBe("Commuter");
    });

    test("reaching a new rank is announced, with when", () => {
        const s = keys({ ...emptyStats(), points: 99 }, 1);
        expect(s.levelUp).toEqual({ rank: 1, at: day(5) });
        expect(keys(s, 1).levelUp).toEqual({ rank: 1, at: day(5) }); // not again until the next
    });

    test("one slip never drops a rank; a week ending below it does", () => {
        const fluent = { ...keys(emptyStats(), 1, "⌘J", day(5)), points: 302, rank: 2 };
        const slipped = recordClick(fluent, "⌘J", day(5));
        expect([slipped.points, rankOf(slipped)]).toEqual([294, "Fluent"]);
        expect(rankOf(recordKey(slipped, "⌘J", day(12)))).toBe("Commuter"); // the 12th starts a new week
    });
});

describe("badges", () => {
    test("bronze at 10 uses of a key, silver at 50, gold at 200, announced with when", () => {
        expect(keys(emptyStats(), 9).badge).toBeUndefined();
        expect(keys(emptyStats(), 10).badge).toEqual({ key: "⌘J", tier: "bronze", at: day(5) });
        expect(keys(emptyStats(), 50).badge?.tier).toBe("silver");
        expect(keys(emptyStats(), 200).badge?.tier).toBe("gold");
    });

    test("other keys don't announce anything", () => expect(keys(keys(emptyStats(), 10), 3, "⌘K").badge?.key).toBe("⌘J"));
});

describe("a day's focus all ticked", () => {
    test("earns 10 once a day, announced with when", () => {
        const s = recordDayDone(keys(emptyStats(), 2), day(5, 15));
        expect([s.points, s.dayDone]).toEqual([12, { date: "2026-10-05", at: day(5, 15) }]);
        expect(recordDayDone(s, day(5, 16)).points).toBe(12);
        expect(recordDayDone(s, day(6, 15)).points).toBe(12 + 20 + 10); // the next day: a clean day's 20, then this
    });
});
