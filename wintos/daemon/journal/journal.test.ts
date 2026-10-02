import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, test } from "vitest";
import { Journal, focusOf, longDate, tomorrowGoals, withFocus } from "./journal";

const TEMPLATE = "# $date (Week $week)\n\n## Today's focus (1-3 items)\n\n- [ ] ...\n\n## Handled tasks\n\n- ...\n\n## Daily reflection\n\n- **Goals and Tasks for tomorrow**\n  - [ ] ...\n";
const DAY = (focus: string, tomorrow = "  - [ ] ...") => `# Thursday\n\n## Today's focus (1-3 items)\n\n${focus}\n\n## Handled tasks\n\n- ...\n\n## Daily reflection\n\n- **Goals and Tasks for tomorrow**\n${tomorrow}\n`;

const setup = () => {
    const dir = mkdtempSync(join(tmpdir(), "journal-"));
    const tpl = join(dir, "daily_template.md");
    writeFileSync(tpl, TEMPLATE);
    const put = (iso: string, text: string) => {
        mkdirSync(join(dir, iso.slice(0, 4), iso.slice(5, 7)), { recursive: true });
        writeFileSync(join(dir, iso.slice(0, 4), iso.slice(5, 7), `${iso}.md`), text);
    };
    return { dir, j: new Journal(dir, tpl), put };
};

describe("the day file's parts", () => {
    test("today's focus is the section under its heading, placeholder left out", () => {
        expect(focusOf(DAY("- [x] Review the export PR\n- [ ] Write the rollout note"))).toBe("- [x] Review the export PR\n- [ ] Write the rollout note");
        expect(focusOf(DAY("- [ ] ..."))).toBe("");
    });

    test("writing the focus changes that section only", () => {
        const before = DAY("- [ ] ...");
        const after = withFocus(before, "- [ ] Pair on the flaky test");
        expect(focusOf(after)).toBe("- [ ] Pair on the flaky test");
        expect(after.replace("- [ ] Pair on the flaky test", "- [ ] ...")).toBe(before);
    });

    test("tomorrow's goals are the real items under that heading", () => expect(tomorrowGoals(DAY("- [ ] a", "  - [ ] Ship the fallback\n  - [ ] ..."))).toEqual(["- [ ] Ship the fallback"]));

    test("the date reads like the template's", () => {
        expect(longDate(new Date(2026, 8, 30))).toBe("Wednesday, September 30th 2026");
        expect(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"].map((s, i) => longDate(new Date(2026, 0, [1, 2, 3, 4, 11, 12, 13, 21, 22][i])).split(" ")[2])).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
    });
});

describe("Journal", () => {
    test("today without a file reads from the template and writes nothing", () => {
        const { j, dir } = setup();
        const d = j.day(new Date(2026, 9, 2));
        expect([d.focus, d.exists]).toEqual(["", false]);
        expect(() => readFileSync(join(dir, "2026", "10", "2026-10-02.md"))).toThrow();
    });

    test("saving the focus creates the day from the template, week and date filled in", () => {
        const { j, dir } = setup();
        expect(j.saveFocus(new Date(2026, 9, 2), "- [ ] Pair on the flaky test")).toBe("ok");
        const text = readFileSync(join(dir, "2026", "10", "2026-10-02.md"), "utf8");
        expect(text.startsWith("# Friday, October 2nd 2026 (Week 40)\n")).toBe(true);
        expect(focusOf(text)).toBe("- [ ] Pair on the flaky test");
    });

    test("a save based on an older file is refused", () => {
        const { j, put } = setup();
        put("2026-10-02", DAY("- [ ] a"));
        expect(j.saveFocus(new Date(2026, 9, 2), "- [ ] b", 1)).toBe("conflict");
    });

    test("yesterday is the last day with a file before today, over weekends and month ends", () => {
        const { j, put } = setup();
        put("2026-09-30", DAY("- [x] Review the export PR\n- [ ] Write the rollout note", "  - [ ] Ship the fallback"));
        const d = j.day(new Date(2026, 9, 5));
        expect([d.yesterday?.date, d.yesterday?.focus, d.yesterday?.tomorrow]).toEqual(["2026-09-30", "- [x] Review the export PR\n- [ ] Write the rollout note", ["- [ ] Ship the fallback"]]);
    });

    test("planned is remembered per day", () => {
        const { j } = setup();
        const today = new Date(2026, 9, 2);
        expect(j.day(today).planned).toBe(false);
        j.markPlanned(today);
        expect([j.day(today).planned, j.day(new Date(2026, 9, 3)).planned]).toEqual([true, false]);
    });
});
