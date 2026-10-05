import { describe, expect, test } from "vitest";
import { lastDayName, leftFromYesterday } from "./day";

const day = (focus: string, yesterday?: { focus: string; tomorrow: string[] }) => ({ date: "2026-10-02", exists: true, mtime: 1, focus, planned: false, ...(yesterday ? { yesterday: { date: "2026-10-01", ...yesterday } } : {}) });

describe("leftFromYesterday", () => {
    test("yesterday's open focus items, then its goals for tomorrow, without ticked ones or repeats", () =>
        expect(leftFromYesterday(day("", { focus: "- [x] Review\n- [ ] Write the note", tomorrow: ["- [ ] Ship it", "- [ ] Write the note", "- [x] Old"] }))).toEqual(["Write the note", "Ship it"]));

    test("already carried into today, it is no longer left", () => expect(leftFromYesterday(day("- [ ] Ship it", { focus: "", tomorrow: ["- [ ] Ship it"] }))).toEqual([]));

    test("no earlier day, nothing left", () => expect(leftFromYesterday(day(""))).toEqual([]));
});

describe("lastDayName", () => {
    test.each([
        ["2026-10-01", "2026-10-02", "Yesterday"], // Thu → Fri
        ["2026-09-30", "2026-10-02", "Wednesday"], // same week
        ["2026-10-02", "2026-10-05", "Last Friday"], // a weekend between
        ["2026-09-21", "2026-10-05", "21 September"], // further back
    ])("%s seen from %s is %s", (last, today, name) => expect(lastDayName(last, today)).toBe(name));
});
