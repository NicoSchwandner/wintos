import { describe, expect, test } from "vitest";
import { heldUntil } from "./hold";

const MIN = 60_000;
const P = 20 * MIN;
const T = 1000 * P; // a batch boundary
const row = (waitingSince: number, tabId = "t") => ({ tabId, waitingSince });

describe("heldUntil", () => {
    test("batches: what came in since the last boundary waits for the next", () => {
        expect(heldUntil(row(T + 5 * MIN), { now: T + 6 * MIN, batchEveryMs: P })).toBe(T + P);
        expect(heldUntil(row(T + 5 * MIN), { now: T + P, batchEveryMs: P })).toBeUndefined();
        expect(heldUntil(row(T - MIN), { now: T + 6 * MIN, batchEveryMs: P })).toBeUndefined();
    });

    test("⌥⌘O opens the batch now: what came in before it shows", () => {
        expect(heldUntil(row(T + 5 * MIN), { now: T + 7 * MIN, batchEveryMs: P, releasedAt: T + 6 * MIN })).toBeUndefined();
        expect(heldUntil(row(T + 8 * MIN), { now: T + 9 * MIN, batchEveryMs: P, releasedAt: T + 6 * MIN })).toBe(T + P);
    });

    test("the project you are in is never held: you see it there anyway", () =>
        expect(heldUntil(row(T + 5 * MIN), { now: T + 6 * MIN, batchEveryMs: P, here: "t" })).toBeUndefined());

    test("no batches: nothing is held", () => expect(heldUntil(row(T + 5 * MIN), { now: T + 6 * MIN, batchEveryMs: 0 })).toBeUndefined());

    test("a break holds what comes in during it until you are back", () => {
        expect(heldUntil(row(T + 5 * MIN), { now: T + 6 * MIN, batchEveryMs: 0, breakFrom: T + 2 * MIN })).toBe(Infinity);
        expect(heldUntil(row(T + MIN), { now: T + 6 * MIN, batchEveryMs: 0, breakFrom: T + 2 * MIN })).toBeUndefined();
    });

    test("a focus block holds the other projects until it ends", () => {
        const focus = { tabId: "f", from: T, until: T + 45 * MIN };
        expect(heldUntil(row(T + 5 * MIN, "other"), { now: T + 6 * MIN, batchEveryMs: 0, focus })).toBe(T + 45 * MIN);
        expect(heldUntil(row(T + 5 * MIN, "f"), { now: T + 6 * MIN, batchEveryMs: 0, focus })).toBeUndefined();
        expect(heldUntil(row(T + 5 * MIN, "other"), { now: T + 46 * MIN, batchEveryMs: 0, focus })).toBeUndefined();
        expect(heldUntil(row(T + 5 * MIN, "other"), { now: T + 6 * MIN, batchEveryMs: P, focus })).toBe(T + 45 * MIN);
    });

    test("a closed day holds everything until the workday starts", () =>
        expect(heldUntil(row(T - 60 * MIN), { now: T, batchEveryMs: 0, quietUntil: T + 600 * MIN })).toBe(T + 600 * MIN));
});
