import { describe, expect, test } from "vitest";
import { lastDayName } from "./day";

describe("lastDayName", () => {
    test.each([
        ["2026-10-01", "2026-10-02", "Yesterday"], // Thu → Fri
        ["2026-09-30", "2026-10-02", "Wednesday"], // same week
        ["2026-10-02", "2026-10-05", "Last Friday"], // a weekend between
        ["2026-09-21", "2026-10-05", "21 September"], // further back
    ])("%s seen from %s is %s", (last, today, name) => expect(lastDayName(last, today)).toBe(name));
});
