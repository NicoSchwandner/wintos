import { describe, expect, test } from "vitest";
import { lastDayName, leftFromYesterday, withCarried, yesterdayItems } from "./day";

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

describe("carrying an item keeps its depth", () => {
    const y = "- [ ] Ship the export\n  - [ ] the fallback\n    - [ ] its test\n- [ ] Review";
    const chainOf = (text: string) => yesterdayItems(day("", { focus: y, tomorrow: [] })).find((i) => i.text === text)!.chain;
    test("a top-level item goes at the end", () => expect(withCarried("- [ ] Pair", chainOf("Review"))).toBe("- [ ] Pair\n- [ ] Review"));
    test("a sub-item brings its parents when today lacks them", () =>
        expect(withCarried("- [ ] Pair", chainOf("its test"))).toBe("- [ ] Pair\n- [ ] Ship the export\n  - [ ] the fallback\n    - [ ] its test"));
    test("a sub-item whose parent today has goes under it, not at the end", () =>
        expect(withCarried("- [ ] Ship the export\n  - [ ] docs\n- [ ] Pair", chainOf("the fallback"))).toBe("- [ ] Ship the export\n  - [ ] docs\n  - [ ] the fallback\n- [ ] Pair"));
    test("into an empty day", () => expect(withCarried("", chainOf("Review"))).toBe("- [ ] Review"));
});
