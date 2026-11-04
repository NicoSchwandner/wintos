import { describe, expect, test } from "vitest";
import { heldUntil } from "./hold";

const MIN = 60_000;
const T = 1000 * 20 * MIN;
const row = (waitingSince: number, tabId = "t") => ({ tabId, waitingSince });

describe("heldUntil", () => {
    test("the project you are in is never held: you see it there anyway", () =>
        expect(heldUntil(row(T + 5 * MIN), { now: T + 6 * MIN, breakFrom: T + 2 * MIN, here: "t" })).toBeUndefined());

    test("no break: nothing is held", () => expect(heldUntil(row(T + 5 * MIN), { now: T + 6 * MIN })).toBeUndefined());

    test("a break holds what comes in during it until you are back", () => {
        expect(heldUntil(row(T + 5 * MIN), { now: T + 6 * MIN, breakFrom: T + 2 * MIN })).toBe(Infinity);
        expect(heldUntil(row(T + MIN), { now: T + 6 * MIN, breakFrom: T + 2 * MIN })).toBeUndefined();
    });

    test("a closed day holds everything until the workday starts", () =>
        expect(heldUntil(row(T - 60 * MIN), { now: T, quietUntil: T + 600 * MIN })).toBe(T + 600 * MIN));
});
