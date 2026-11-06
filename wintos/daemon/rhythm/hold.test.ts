import { describe, expect, test } from "vitest";
import { isHeld } from "./hold";

const MIN = 60_000;
const T = 1000 * 20 * MIN;
const row = (waitingSince: number, tabId = "t") => ({ tabId, waitingSince });

describe("isHeld", () => {
    test("the project you are in is never held: you see it there anyway", () =>
        expect(isHeld(row(T + 5 * MIN), { breakFrom: T + 2 * MIN, here: "t" })).toBe(false));

    test("no break: nothing is held", () => expect(isHeld(row(T + 5 * MIN), {})).toBe(false));

    test("a break holds what comes in during it until you are back", () => {
        expect(isHeld(row(T + 5 * MIN), { breakFrom: T + 2 * MIN })).toBe(true);
        expect(isHeld(row(T + MIN), { breakFrom: T + 2 * MIN })).toBe(false);
    });
});
