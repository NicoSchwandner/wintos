import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, test } from "vitest";
import { Journal, focusOf, longDate, withFocus } from "./journal";
import { goalsAhead } from "./reflection";

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

    test("tomorrow's goals are the real items under that heading", () => expect(goalsAhead(DAY("- [ ] a", "  - [ ] Ship the fallback\n  - [ ] ..."))).toEqual(["- [ ] Ship the fallback"]));

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

    test("a missing day is made by the journal's own tool when there is one, and the focus written into it", () => {
        const { dir } = setup();
        const tpl = join(dir, "daily_template.md");
        const file = join(dir, "2026", "10", "2026-10-02.md");
        const j = new Journal(dir, tpl, join(dir, ".planned.json"), () => (mkdirSync(join(dir, "2026", "10"), { recursive: true }), writeFileSync(file, "# Made by the tool\n\n## Today's focus (1-3 items)\n\n- [ ] ...\n\n## Weekly reflection\n")));
        expect(j.saveFocus(new Date(2026, 9, 2), "- [ ] Plan")).toBe("ok");
        const text = readFileSync(file, "utf8");
        expect([text.startsWith("# Made by the tool"), focusOf(text), text.includes("## Weekly reflection")]).toEqual([true, "- [ ] Plan", true]);
    });

    test("a tool that fails or makes nothing leaves the template to make the day", () => {
        const { dir } = setup();
        const j = new Journal(dir, join(dir, "daily_template.md"), join(dir, ".planned.json"), () => { throw new Error("not installed"); });
        expect(j.saveFocus(new Date(2026, 9, 2), "- [ ] Plan")).toBe("ok");
        expect(readFileSync(join(dir, "2026", "10", "2026-10-02.md"), "utf8").startsWith("# Friday, October 2nd 2026 (Week 40)")).toBe(true);
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

    test("a weekend file is never yesterday: Monday looks back to Friday", () => {
        const { j, put } = setup();
        put("2026-10-09", DAY("- [ ] Friday's plan"));
        put("2026-10-11", DAY("- [ ] a Sunday to-do"));
        expect(j.day(new Date(2026, 9, 12)).yesterday?.date).toBe("2026-10-09");
    });

    test("planned is remembered per day", () => {
        const { j } = setup();
        const today = new Date(2026, 9, 2);
        expect(j.day(today).planned).toBe(false);
        j.markPlanned(today);
        expect([j.day(today).planned, j.day(new Date(2026, 9, 3)).planned]).toEqual([true, false]);
    });
});

describe("reflections", () => {
    const WEEKLY = "## Weekly reflection - Week $week/$year\n\n- **Goals Review**\n  - Which goals did you move forward?\n- **Goals and Tasks for the next week**\n  - What needs to get done?\n    - [ ] ...\n";
    const MONTHLY = "## Monthly Reflection - $month $year\n\n### Goals Review\n\n- Which monthly goals did you meet?\n\n### Goals and Tasks for Next Month\n\n- Outline your main objectives.\n  - [ ] ...\n";
    const friday = (body: string, focus = "- [ ] a") => `# Friday\n\n## Today's focus (1-3 items)\n\n${focus}\n\n${body}`;
    const withTemplates = () => {
        const s = setup();
        writeFileSync(join(s.dir, "weekly_template.md"), `# $date\n\n${WEEKLY}`);
        writeFileSync(join(s.dir, "monthly_template.md"), `# $date\n\n${MONTHLY}`);
        return s;
    };
    const at = (iso: string, hour: number) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)), hour);

    test("the nudge: from 14:00 on its Friday, still on Monday, gone once written or a week old", () => {
        const { j, put } = withTemplates();
        put("2026-10-23", friday(WEEKLY.replace("Week $week/$year", "Week 43/2026")));
        expect(j.day(at("2026-10-23", 13)).reflection).toBeUndefined();
        expect(j.day(at("2026-10-23", 14)).reflection).toEqual({ date: "2026-10-23", level: "weekly", title: "Weekly reflection - Week 43/2026" });
        expect(j.day(at("2026-10-26", 9)).reflection?.date).toBe("2026-10-23");
        expect(j.day(at("2026-10-31", 9)).reflection).toBeUndefined();
        put("2026-10-23", friday(WEEKLY.replace("move forward?", "move forward?\n    - The export shipped")));
        expect(j.day(at("2026-10-26", 9)).reflection).toBeUndefined();
    });

    test("a weekly looks back on its days and on the goals the last reflection set", () => {
        const { j, put } = withTemplates();
        put("2026-10-16", friday(WEEKLY.replace("    - [ ] ...", "    - [ ] Release the export")));
        put("2026-10-19", DAY("- [x] Monday's plan"));
        put("2026-10-24", DAY("- [ ] a Saturday to-do"));
        put("2026-10-23", friday(WEEKLY, "- [ ] Friday's plan"));
        const r = j.reflection(at("2026-10-23", 15))!;
        expect([r.date, r.level, r.days, r.earlier]).toEqual(["2026-10-23", "weekly", [{ date: "2026-10-19", focus: "- [x] Monday's plan" }, { date: "2026-10-23", focus: "- [ ] Friday's plan" }], []]);
        expect(r.goals).toEqual({ date: "2026-10-16", title: "Weekly reflection - Week $week/$year", items: ["- [ ] Release the export"] });
    });

    test("a monthly looks back on the weeklies since the last monthly, as their answers", () => {
        const { j, put } = withTemplates();
        put("2026-09-25", friday(MONTHLY.replace("  - [ ] ...", "  - [ ] Finish the task force")));
        put("2026-10-09", friday(WEEKLY.replace("move forward?", "move forward?\n    - Most")));
        put("2026-10-16", friday(WEEKLY));
        put("2026-10-30", friday(MONTHLY));
        const r = j.reflection(at("2026-10-30", 15))!;
        expect(r.earlier).toEqual([
            { date: "2026-10-16", level: "weekly", title: "Weekly reflection - Week $week/$year", answers: "" },
            { date: "2026-10-09", level: "weekly", title: "Weekly reflection - Week $week/$year", answers: "- **Goals Review**\n    - Most" },
        ]);
        expect([r.days, r.goals?.items]).toEqual([[], ["- [ ] Finish the task force"]]);
    });

    test("Monday's plan builds on Friday's goals for the next week", () => {
        const { j, put } = withTemplates();
        put("2026-10-23", friday(WEEKLY.replace("    - [ ] ...", "    - [ ] Release the export")));
        expect(j.day(at("2026-10-26", 9)).yesterday?.tomorrow).toEqual(["- [ ] Release the export"]);
    });

    test("saving writes the section, and never over a newer file", () => {
        const { j, put, dir } = withTemplates();
        put("2026-10-23", friday(WEEKLY));
        const r = j.reflection(at("2026-10-23", 15))!;
        expect(j.saveReflection("2026-10-23", "- **Goals Review**\n  - All", r.mtime - 1)).toBe("conflict");
        expect(j.saveReflection("2026-10-23", "- **Goals Review**\n  - All", r.mtime)).toBe("ok");
        expect(readFileSync(join(dir, "2026", "10", "2026-10-23.md"), "utf8")).toBe("# Friday\n\n## Today's focus (1-3 items)\n\n- [ ] a\n\n## Weekly reflection - Week $week/$year\n\n- **Goals Review**\n  - All\n");
        expect(j.saveReflection("2026-10-22", "x", 0)).toBe("missing");
    });
});
