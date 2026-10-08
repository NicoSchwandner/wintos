import { describe, expect, test } from "vitest";
import { newestFirst, parseNotes } from "./parse";

const body = `## Goal
Keep invoice ingestion above 99% page coverage.

## Decisions
- 18 sep — Fall back locally. Documents never leave our VPC.
- 2026-09-19: Confidence is scored per page.
- An undated decision

## Built
- [x] \`ocr/adapters/tesseract.ts\` — render and extract
- [~] Queue consumer wiring
- [ ] Per-tenant threshold storage
- Metrics, no marker

## Open questions
- Nullable column, or a separate table? (blocking)
- Re-run or keep the first result?

## Risks
Vendor contract ends in Q4.
`;

describe("parseNotes", () => {
    const n = parseNotes(body);

    test("goal is the first paragraph under Goal", () => expect(n.goal).toBe("Keep invoice ingestion above 99% page coverage."));

    test("decisions carry their date when they have one", () =>
        expect(n.decisions).toEqual([
            { date: "18 sep", text: "Fall back locally. Documents never leave our VPC." },
            { date: "2026-09-19", text: "Confidence is scored per page." },
            { text: "An undated decision" },
        ]));

    test("built items carry done / partial / todo, unmarked ones none", () =>
        expect(n.built.map((b) => b.state)).toEqual(["done", "partial", "todo", undefined]));

    test("the blocking question is flagged and its marker removed", () =>
        expect(n.questions).toEqual([
            { text: "Nullable column, or a separate table?", blocking: true },
            { text: "Re-run or keep the first result?", blocking: false },
        ]));

    test("sections the design doesn't know are kept, not dropped", () =>
        expect(n.other).toEqual([{ heading: "Risks", text: "Vendor contract ends in Q4." }]));

    test("an empty or headerless body yields empty sections and keeps the text", () => {
        expect(parseNotes("")).toEqual({ decisions: [], built: [], questions: [], other: [] });
        expect(parseNotes("just some notes").other).toEqual([{ heading: "", text: "just some notes" }]);
    });

    test("CRLF parses like LF", () => expect(parseNotes("## Goal\r\nX\r\n").goal).toBe("X"));
});

describe("newestFirst", () => {
    const today = new Date(2026, 9, 8);
    test("orders decisions by date, newest first, whatever order the file has", () =>
        expect(newestFirst([{ date: "2 Oct", text: "a" }, { date: "2026-10-07", text: "b" }, { date: "30 Sep", text: "c" }, { date: "5 Oct", text: "d" }], today).map((d) => d.text)).toEqual(["b", "d", "a", "c"]));
    test("a day without a year later than today is last year's", () =>
        expect(newestFirst([{ date: "20 Dec", text: "last year" }, { date: "1 Jan", text: "this year" }], today).map((d) => d.text)).toEqual(["this year", "last year"]));
    test("undated decisions keep their order after the dated ones", () =>
        expect(newestFirst([{ text: "x" }, { date: "1 Oct", text: "a" }, { text: "y" }], today).map((d) => d.text)).toEqual(["a", "x", "y"]));
});
