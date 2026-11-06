import { describe, expect, test } from "vitest";
import { clampRail } from "./railWidth";

describe("clampRail", () => {
    test("a drag inside the limits is kept", () => expect(clampRail(480, 1500)).toBe(480));
    test("never narrower than a readable note", () => expect(clampRail(100, 1500)).toBe(260));
    test("never more than 60% of the window, so the terminals stay", () => expect(clampRail(1400, 1500)).toBe(900));
    test("a very small window still gets the minimum", () => expect(clampRail(400, 300)).toBe(260));
});
