import { describe, expect, test } from "vitest";
import { answersOf, goalsAhead, reflectionOf, withReflection, withTomorrow } from "./reflection";

// The shapes work-journal's templates give a Friday: questions as bold bullets (weekly) or ###
// headings (monthly and up), with "- [ ] ..." where the goals go.
const WEEKLY_TPL = [
    "## Weekly reflection - Week $week/$year",
    "",
    "- **Goals Review**",
    "  - Which of this week’s goals did you achieve or move forward?",
    "- **Goals and Tasks for the next week**",
    "  - What **absolutely needs** to get done next week?",
    "    - [ ] ...",
    "- **What do I start working on Monday morning?**",
    "  - [ ] ...",
].join("\n");
const week = (body: string) => `# Friday\n\n## Today's focus (1-3 items)\n\n- [ ] a\n\n${body}\n`;

describe("reflectionOf", () => {
    test("finds the section, its level and title, up to the next ## heading", () => {
        const r = reflectionOf(week(WEEKLY_TPL) + "\n## Notes\n\n- later");
        expect([r?.level, r?.title, r?.body.split("\n")[0]]).toEqual(["weekly", "Weekly reflection - Week $week/$year", "- **Goals Review**"]);
        expect(r?.body).not.toContain("later");
        expect(reflectionOf("# Monday\n\n## Monthly Reflection - October 2026\n\n### Goals Review\n")?.level).toBe("monthly");
    });
    test("a day without one has none", () => expect(reflectionOf("# Thursday\n\n## Daily reflection\n\n- x")).toBeUndefined());
});

describe("answersOf", () => {
    const tpl = reflectionOf(week(WEEKLY_TPL))!.body;
    test("the template alone has no answers", () => expect(answersOf(tpl, tpl)).toBe(""));
    test("your lines, each under the question it answers", () => {
        const mine = tpl.replace("move forward?", "move forward?\n    - Shipped the export").replace(/\n  - \[ \] \.\.\.$/, "\n  - [ ] Pair on the flaky test");
        expect(answersOf(mine, tpl)).toBe("- **Goals Review**\n    - Shipped the export\n- **What do I start working on Monday morning?**\n  - [ ] Pair on the flaky test");
    });
    test("an answer written on the question's own line counts", () =>
        expect(answersOf(tpl.replace("move forward?", "move forward? Most of them"), tpl)).toBe("- **Goals Review**\n  - Which of this week’s goals did you achieve or move forward? Most of them"));
});

describe("goalsAhead", () => {
    test("a day's goals for tomorrow", () =>
        expect(goalsAhead("## Daily reflection\n\n- **Goals and Tasks for tomorrow**\n  - [ ] Ship the fallback\n  - [ ] ...\n")).toEqual(["- [ ] Ship the fallback"]));
    test("a weekly's goals for next week and for Monday morning, without the questions", () => {
        const md = week(WEEKLY_TPL.replace("    - [ ] ...", "    - [ ] Release the export\n    - [ ] ...").replace(/\n  - \[ \] \.\.\.$/, "\n  - [ ] Review the DO PR"));
        expect(goalsAhead(md)).toEqual(["- [ ] Release the export", "- [ ] Review the DO PR"]);
    });
    test("a monthly's goals under its ### headings", () => {
        const md = "## Monthly Reflection - October 2026\n\n### Challenges\n\n- [ ] not a goal\n\n### Goals and Tasks for Next Month\n\n- Outline your main objectives.\n  - [ ] Finish the Coder task force\n  - [ ]\n\n### What do I start working on Monday morning?\n\n- [ ] Plan November\n";
        expect(goalsAhead(md)).toEqual(["- [ ] Finish the Coder task force", "- [ ] Plan November"]);
    });
});

describe("withReflection", () => {
    test("replaces the section's body and leaves the rest of the day alone", () => {
        const md = week(WEEKLY_TPL) + "\n## Notes\n\n- later\n";
        const out = withReflection(md, "- **Goals Review**\n  - All of them");
        expect(reflectionOf(out)?.body).toBe("- **Goals Review**\n  - All of them");
        expect(out.startsWith("# Friday\n\n## Today's focus (1-3 items)\n\n- [ ] a\n\n## Weekly reflection - Week $week/$year\n\n")).toBe(true);
        expect(out.endsWith("\n## Notes\n\n- later\n")).toBe(true);
    });
});

describe("withTomorrow", () => {
    const day = "# Day\n\n## Daily reflection\n\n- **Goals and Tasks for tomorrow**\n  - [ ] ...\n\n## Notes\n";
    test("the items go under the question, the placeholder gives way, and goalsAhead reads them back", () => {
        const md = withTomorrow(day, ["Decide the docs routing", "Ship the export"]);
        expect(md).toBe("# Day\n\n## Daily reflection\n\n- **Goals and Tasks for tomorrow**\n  - [ ] Decide the docs routing\n  - [ ] Ship the export\n\n## Notes\n");
        expect(goalsAhead(md)).toEqual(["- [ ] Decide the docs routing", "- [ ] Ship the export"]);
    });
    test("added after what is there, none twice", () =>
        expect(goalsAhead(withTomorrow(withTomorrow(day, ["A"]), ["A", "B"]))).toEqual(["- [ ] A", "- [ ] B"]));
    test("a day without the question gets it", () =>
        expect(goalsAhead(withTomorrow("# Day\n\n## Today's focus (1-3 items)\n\n- [ ] x\n", ["A"]))).toEqual(["- [ ] A"]));
});
