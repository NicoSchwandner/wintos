import { describe, expect, test } from "vitest";
import { parseNotes, spans } from "./parse";

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

describe("spans", () => {
    test("backticks become code spans", () =>
        expect(spans("use `invoice_page` or `ocr_result`")).toEqual([
            { text: "use " },
            { text: "invoice_page", code: true },
            { text: " or " },
            { text: "ocr_result", code: true },
        ]));

    test("a markdown link shows its text and keeps its url", () =>
        expect(spans("see [the PR](https://github.com/acme/api/pull/7) first")).toEqual([
            { text: "see " },
            { text: "the PR", url: "https://github.com/acme/api/pull/7" },
            { text: " first" },
        ]));

    test("a bare url shows as host and path, without the sentence's full stop", () =>
        expect(spans("Deployed to https://www.example.com/runs/42.")).toEqual([
            { text: "Deployed to " },
            { text: "example.com/runs/42", url: "https://www.example.com/runs/42" },
            { text: "." },
        ]));

    test("a url inside backticks stays code", () => expect(spans("`https://example.com`")).toEqual([{ text: "https://example.com", code: true }]));

    test("a long bare url is shortened", () => {
        const url = `https://example.com/${"a".repeat(80)}`;
        expect(spans(url)).toEqual([{ text: `example.com/${"a".repeat(35)}…`, url }]);
    });
});
