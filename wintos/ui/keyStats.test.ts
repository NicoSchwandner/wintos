import { describe, expect, test } from "vitest";
import { emptyStats } from "../daemon/keyboard/keyboard";
import { badges, neverUsed, progress, week } from "./keyStats";

describe("progress", () => {
    test("the rank, the next one, and how far", () =>
        expect(progress({ ...emptyStats(), points: 412, rank: 2 })).toEqual({ rank: "Fluent", next: "Mouse-free", points: 412, toNext: 288, pct: 28 }));
    test("at the top there is no next", () => expect(progress({ ...emptyStats(), points: 60000, rank: 9 })).toEqual({ rank: "Zen", points: 60000, toNext: 0, pct: 100 }));
});

describe("badges", () => {
    test("each key used 10+ times, its tier and what the next takes, most used first", () =>
        expect(badges({ ...emptyStats(), keys: { "⌘J": 212, "⌥⌘P": 12, "⇧⌘C": 3 } })).toEqual([
            { key: "⌘J", count: 212, tier: "gold" },
            { key: "⌥⌘P", count: 12, tier: "bronze", next: 50 },
        ]));
});

describe("neverUsed", () => {
    const sections: [string, [string, string][]][] = [["Projects", [["⌘J / ⌘K", "walk"], ["⌥⌘Z", "snooze"], ["j / k", "rows"]]]];
    test("rows of the key card none of whose keys were ever used", () =>
        expect(neverUsed(sections, { ...emptyStats(), keys: { "⌘K": 1, j: 4 } })).toEqual([["⌥⌘Z", "snooze"]]));
});

describe("week", () => {
    test("the last seven days, oldest first, zero where nothing happened", () => {
        const w = week({ ...emptyStats(), days: { "2026-10-03": { keys: 40, clicks: 2 } } }, new Date(2026, 9, 3, 12).getTime());
        expect([w.length, w[0].date, w[6]]).toEqual([7, "2026-09-27", { date: "2026-10-03", keys: 40, clicks: 2 }]);
    });
});
