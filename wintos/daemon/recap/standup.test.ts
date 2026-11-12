import { describe, expect, test } from "vitest";
import { detailsMarkdown, edit, itemsMarkdown, parseItems, shownItems, splitText, type Curation } from "./standup";

const empty: Curation = { days: {}, examples: [] };
const items = parseItems(
    ["Here:", "- [Intake] Ready for review: Document intake", "  - Register-only intake", "  - Never delivered", "- [Ghost] Merged: PDFs", "- Asks nothing"].join("\n"),
    ["Intake", "PDFs"],
);

describe("parseItems", () => {
    test("each bullet an item with its project and the indented lines under it", () =>
        expect(items).toEqual([
            { id: "0", project: "Intake", text: "Ready for review: Document intake", details: ["Register-only intake", "Never delivered"] },
            { id: "1", project: "", text: "Merged: PDFs", details: [] },
            { id: "2", project: "", text: "Asks nothing", details: [] },
        ]));
});

test("splitText keeps how deep each detail sits under the item", () =>
    expect(splitText("- Merged: PDFs\n  - fallback\n    - asked twice\n      - by QA\n  - shipped")).toEqual({ text: "Merged: PDFs", details: ["fallback", "  asked twice", "    by QA", "shipped"] }));

test("parseItems keeps how deep each detail sits under the item", () =>
    expect(parseItems("- [Intake] Merged\n  - a\n    - b", ["Intake"])[0].details).toEqual(["a", "  b"]));

test("detailsMarkdown nests the details as a list", () => expect(detailsMarkdown(["a", "  b", "c"])).toBe("- a\n  - b\n- c"));

test("splitText: the first line is the item, the bulleted rest its details", () =>
    expect(splitText("- Merged: PDFs\n  - fallback asked\n\n")).toEqual({ text: "Merged: PDFs", details: ["fallback asked"] }));

describe("editing the list", () => {
    const md = (c: Curation, day = "d1") => itemsMarkdown(shownItems(items, c, day));

    test("it starts as the items, details nested under each", () =>
        expect(md(empty)).toBe("- Ready for review: Document intake\n  - Register-only intake\n  - Never delivered\n- Merged: PDFs\n- Asks nothing"));

    test("a deleted line drops its item, a moved one moves it, an added one is new", () => {
        const c = edit(empty, "d1", items, "- Asks nothing\n- Ready for review: Document intake\n  - Register-only intake\n  - Never delivered\n- Paired on the importer");
        expect(shownItems(items, c, "d1").map((i) => [i.id, i.text, i.dropped])).toEqual([
            ["2", "Asks nothing", false],
            ["0", "Ready for review: Document intake", false],
            ["+3", "Paired on the importer", false],
            ["1", "Merged: PDFs", true],
        ]);
        expect(c.examples).toEqual([]);
    });

    test("a line with nothing in common with the item it replaced is a new one", () => {
        const c = edit(empty, "d1", items, "- Paired on the importer\n- Merged: PDFs\n- Asks nothing");
        expect(shownItems(items, c, "d1").map((i) => [i.id, i.dropped])).toEqual([["+3", false], ["1", false], ["2", false], ["0", true]]);
    });

    test("a changed line rewrites the item in its place and becomes an example; only the last three are kept", () => {
        let c = empty;
        for (let n = 0; n < 4; n++) c = edit(c, "d1", items, `- Review: intake ${n}\n  - detail\n    - deeper\n- Merged: PDFs\n- Asks nothing`);
        expect(shownItems(items, c, "d1")[0]).toMatchObject({ id: "0", text: "Review: intake 3", details: ["detail", "  deeper"], edited: true });
        expect(c.examples.map((e) => e.mine)).toEqual([1, 2, 3].map((n) => `Review: intake ${n}\n- detail\n  - deeper`));
        expect(c.examples[0].draft).toBe("Ready for review: Document intake\n- Register-only intake\n- Never delivered");
    });

    test("saving it unchanged changes nothing you'd see and teaches nothing", () => {
        const c = edit(empty, "d1", items, md(empty));
        expect(md(c)).toBe(md(empty));
        expect(c.examples).toEqual([]);
        expect(shownItems(items, c, "d1").some((i) => i.edited)).toBe(false);
    });

    test("a dropped item stays dropped through later edits", () => {
        let c = edit(empty, "d1", items, "- Merged: PDFs");
        c = edit(c, "d1", items, "- Merged: PDFs\n- Asks nothing");
        expect(shownItems(items, c, "d1").filter((i) => !i.dropped).map((i) => i.id)).toEqual(["1", "2"]);
    });
});

test("a drop holds for its day only", () => {
    const c = edit(edit(empty, "d1", items, "- Merged: PDFs"), "d2", items, "- Merged: PDFs");
    expect(shownItems(items, c, "d2")[0].dropped).toBe(false);
    expect(shownItems(items, c, "d2").at(-1)?.dropped).toBe(true);
    expect(shownItems(items, c, "d3").some((i) => i.dropped)).toBe(false);
});
