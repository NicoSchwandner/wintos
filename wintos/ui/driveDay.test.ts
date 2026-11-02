import { describe, expect, test } from "vitest";
import { driveDay, driveDayLine } from "./driveDay";

const NOW = new Date(2026, 10, 2, 16).getTime();
const pr = (o: object) => ({ author: "me", createdAt: new Date(2026, 9, 1).toISOString(), ...o }) as never;

describe("driveDay", () => {
    test("today's prompts and waits, and your PRs opened or merged today", () => {
        const today = new Date(2026, 10, 2, 9).toISOString();
        const d = driveDay({ prompts: 23, waitedMs: 70 * 60_000 }, [pr({ createdAt: today }), pr({ mergedAt: today }), pr({ author: "ana", createdAt: today }), pr({})], "me", NOW);
        expect([d, driveDayLine(d)]).toEqual([{ prompts: 23, waitedMs: 70 * 60_000, opened: 1, merged: 1 }, "23 prompts · 1 PR opened · 1 merged · waited 1 h 10 on you"]);
    });
    test("a quiet day says only the prompts; a wait under a minute is not worth a word", () => {
        expect(driveDayLine(driveDay(undefined, [], "me", NOW))).toBe("0 prompts");
        expect(driveDayLine(driveDay({ prompts: 1, waitedMs: 25 * 60_000 }, [], "me", NOW))).toBe("1 prompt · waited 25 min on you");
    });
});
