import { describe, expect, test } from "vitest";
import { searchPalette, type PaletteItem } from "./palette-search";

const items: PaletteItem[] = [
    { id: "p1", kind: "project", title: "Invoice OCR fallback", subtitle: "needs you · schema question" },
    { id: "p2", kind: "project", title: "OCR vendor evaluation", subtitle: "out of the sidebar · last touched 5 weeks ago" },
    { id: "s1", kind: "session", title: "ocr-adapter", subtitle: "running · Invoice OCR fallback" },
    { id: "a1", kind: "action", title: "New session in Invoice OCR fallback", hint: "⇧⌘N" },
    { id: "a2", kind: "action", title: "PRs need attention", hint: "⇧⌘P" },
];

describe("searchPalette", () => {
    test("an empty query lists everything, grouped projects → sessions → actions", () =>
        expect(searchPalette(items, "").map((i) => i.id)).toEqual(["p1", "p2", "s1", "a1", "a2"]));

    test("a prefix beats a word match beats a scattered match", () =>
        expect(searchPalette(items, "ocr").map((i) => i.id)).toEqual(["p2", "s1", "p1", "a1"]));

    test("scattered letters still find it (fuzzy)", () => expect(searchPalette(items, "prsna").map((i) => i.id)).toEqual(["a2"]));

    test("case and extra spaces don't matter", () => expect(searchPalette(items, "  VENDOR ").map((i) => i.id)).toEqual(["p2"]));

    test("subtitles are searched too, below title matches", () => expect(searchPalette(items, "schema").map((i) => i.id)).toEqual(["p1"]));

    test("no match, nothing", () => expect(searchPalette(items, "zzz")).toEqual([]));
});
