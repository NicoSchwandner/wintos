import { describe, expect, test } from "vitest";
import { dayTimeline, focusLines, focusList, openFocus, openWithNotes, parseSpan } from "./dayplan";

const DAY = new Date(2026, 9, 2);
const t = (h: number, m = 0) => new Date(2026, 9, 2, h, m).getTime();

describe("parseSpan", () => {
    test("reads HH:MM-HH:MM as minutes", () => expect(parseSpan("11:30-13:00")).toEqual([690, 780]));
    test("anything else is no lunch", () => expect([parseSpan(undefined), parseSpan("noon"), parseSpan("13:00-11:30")]).toEqual([undefined, undefined, undefined]));
});

describe("dayTimeline", () => {
    const meetings = [{ title: "Daily", start: t(9, 30), end: t(9, 45) }, { title: "Refinement", start: t(13, 30), end: t(14, 15) }, { title: "Tomorrow", start: t(33), end: t(34) }];

    test("the workday split into meetings, lunch and the free time between", () => {
        const { blocks, freeMs } = dayTimeline(meetings, [690, 780], DAY, [480, 1080]);
        expect(blocks.map((b) => [b.kind, new Date(b.start).getHours() * 60 + new Date(b.start).getMinutes(), (b.end - b.start) / 60_000])).toEqual([
            ["free", 480, 90],
            ["meeting", 570, 15],
            ["free", 585, 105],
            ["lunch", 690, 90],
            ["free", 780, 30],
            ["meeting", 810, 45],
            ["free", 855, 225],
        ]);
        expect(freeMs).toBe((90 + 105 + 30 + 225) * 60_000);
    });

    test("a meeting over lunch is a meeting, and gaps under 15 minutes are not free time", () => {
        const { blocks } = dayTimeline([{ title: "Lunch talk", start: t(12), end: t(12, 30) }, { title: "A", start: t(8), end: t(8, 50) }, { title: "B", start: t(9), end: t(18) }], [690, 780], DAY, [480, 1080]);
        expect(blocks.filter((b) => b.kind === "free")).toEqual([]);
        // B covers the lunch break too, so no lunch shows; meetings keep their own order.
        expect(blocks.map((b) => [b.kind, b.title])).toEqual([["meeting", "A"], ["meeting", "B"], ["meeting", "Lunch talk"]]);
    });

    test("overlapping meetings sit side by side; one alone keeps the full width", () => {
        const { blocks } = dayTimeline([{ title: "A", start: t(9), end: t(10) }, { title: "B", start: t(9, 30), end: t(10, 30) }, { title: "C", start: t(10), end: t(11) }, { title: "D", start: t(14), end: t(15) }], undefined, DAY, [480, 1080]);
        expect(blocks.filter((b) => b.kind === "meeting").map((b) => [b.title, b.col, b.cols])).toEqual([["A", 0, 2], ["B", 1, 2], ["C", 0, 2], ["D", 0, 1]]);
    });
});

test("the workday defaults to 08:00-17:00 and ends the timeline", () => {
    const { from, to, freeMs } = dayTimeline([], undefined, DAY);
    expect([new Date(from).getHours(), new Date(to).getHours(), freeMs]).toEqual([8, 17, 9 * 3_600_000]);
});

describe("focusList", () => {
    test("the checklist lines with their line in the text, done or not; other lines skipped", () =>
        expect(focusList("- [x] Review\nnote\n- [ ] Write\n  - [ ] sub\n\t\t- [ ] tabbed")).toEqual([
            { line: 0, text: "Review", done: true, depth: 0 },
            { line: 2, text: "Write", done: false, depth: 0 },
            { line: 3, text: "sub", done: false, depth: 1 },
            { line: 4, text: "tabbed", done: false, depth: 2 },
        ]));
});

describe("openFocus", () => {
    const text = "- [x] Ship it\n  - [ ] tell the team\n  - [x] tag\n- [x] Done and dusted\n  - [x] all of it\n- [ ] Open";
    test("the open items, and a ticked one only while something under it is open", () =>
        expect(openFocus(focusList(text)).map((i) => `${i.text}${i.done ? " (done)" : ""}`)).toEqual(["Ship it (done)", "tell the team", "Open"]));

});

describe("the plain bullets among the boxes", () => {
    const text = "- [x] Ship it\n  - asked QA\n- [ ] Open\n  - why it waits\n    - deeper\n- [x] Gone\n  - its note\n- a loose note";
    test("focusLines has them as notes, at their depth", () =>
        expect(focusLines(text).filter((l) => l.note).map((l) => [l.line, l.text, l.depth])).toEqual([[1, "asked QA", 1], [3, "why it waits", 1], [4, "deeper", 2], [6, "its note", 1], [7, "a loose note", 0]]));
    test("a note shows while the item it sits under does, and one under no item always", () =>
        expect(openWithNotes(focusLines(text)).map((l) => l.text)).toEqual(["Open", "why it waits", "deeper", "a loose note"]));
});
