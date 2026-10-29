import { describe, expect, test } from "vitest";
import { choose, parseItems, shownItems, splitText, type Curation } from "./standup";

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

test("splitText: the first line is the item, the bulleted rest its details", () =>
    expect(splitText("- Merged: PDFs\n  - fallback asked\n\n")).toEqual({ text: "Merged: PDFs", details: ["fallback asked"] }));

describe("choices", () => {
    test("dropped is marked; the last one lifted leads, out of the dropped ones", () => {
        let c = choose(empty, "d1", items[2], { drop: true }, 1);
        c = choose(c, "d1", items[1], { top: true }, 2);
        c = choose(c, "d1", items[2], { top: true }, 3);
        expect(shownItems(items, c, "d1").map((i) => [i.id, i.top, i.dropped])).toEqual([["2", true, false], ["1", true, false], ["0", false, false]]);
        c = choose(c, "d1", items[2], { top: false }, 4);
        expect(shownItems(items, c, "d1").map((i) => i.id)).toEqual(["1", "0", "2"]);
    });

    test("a rewrite replaces the item and becomes an example; only the last three are kept", () => {
        let c = empty;
        for (let n = 0; n < 4; n++) c = choose(c, "d1", items[0], { text: `Mine ${n}\n- detail` }, n);
        expect(shownItems(items, c, "d1")[0]).toMatchObject({ text: "Mine 3", details: ["detail"], edited: true });
        expect(c.examples.map((e) => e.mine)).toEqual(["Mine 1\n- detail", "Mine 2\n- detail", "Mine 3\n- detail"]);
        expect(c.examples[0].draft).toBe("Ready for review: Document intake\n- Register-only intake\n- Never delivered");
        expect(choose(c, "d1", items[0], { text: "  " }, 9)).toEqual(c);
    });
});

test("a drop holds for its day only", () => {
    const c = choose(choose(empty, "d1", items[0], { drop: true }, 0), "d2", items[0], { drop: true }, 0);
    expect(shownItems(items, c, "d2")[0].dropped).toBe(true);
    expect(shownItems(items, c, "d3")[0].dropped).toBe(false);
});
