import { describe, expect, test } from "vitest";
import { continueList, indentLines, toggleBox } from "./listEdit";

// "|" marks the caret.
const at = (s: string) => ({ text: s.replace("|", ""), caret: s.indexOf("|") });
const show = (r: { text: string; caret: number } | null) => (r ? r.text.slice(0, r.caret) + "|" + r.text.slice(r.caret) : null);

describe("continueList", () => {
    test.each([
        ["- [ ] buy milk|", "- [ ] buy milk\n- [ ] |"],
        ["- [x] done thing|", "- [x] done thing\n- [ ] |"],
        ["- a point|", "- a point\n- |"],
        ["* a point|", "* a point\n* |"],
        ["  - nested|", "  - nested\n  - |"],
        ["3. third|", "3. third\n4. |"],
        ["- [ ] split| here", "- [ ] split\n- [ ] | here"],
    ])("%s → %s", (before, after) => expect(show(continueList(at(before).text, at(before).caret))).toBe(after));

    test("an empty item ends the list: its marker goes, no new line", () => {
        expect(show(continueList(...Object.values(at("- [ ] a\n- [ ] |")) as [string, number]))).toBe("- [ ] a\n|");
        expect(show(continueList(...Object.values(at("- a\n- |")) as [string, number]))).toBe("- a\n|");
    });

    test("outside a list, ⏎ is a plain new line (null: leave it to the field)", () => expect(continueList("plain text", 10)).toBeNull());
});

describe("indentLines", () => {
    test("Tab indents the list lines the selection touches by two spaces; ⇧Tab takes them back", () => {
        const text = "- a\n- b\nplain";
        expect(indentLines(text, 0, 5, false)).toEqual({ text: "  - a\n  - b\nplain", start: 2, end: 9 });
        expect(indentLines("  - a\n  - b", 2, 9, true)).toEqual({ text: "- a\n- b", start: 0, end: 5 });
    });

    test("a line that isn't a list item is left alone (null when none is)", () => expect(indentLines("plain", 0, 0, false)).toBeNull());
});

describe("toggleBox", () => {
    test("ticks or unticks the box on the caret's line, the caret staying put", () => {
        expect(toggleBox("- [ ] a\n- [ ] b", 9)).toEqual({ text: "- [ ] a\n- [x] b", caret: 9 });
        expect(toggleBox("- [x] a", 3)).toEqual({ text: "- [ ] a", caret: 3 });
        expect(toggleBox("- plain", 3)).toBeNull();
    });
});
