import { describe, expect, test } from "vitest";
import { groupHits, searchPalette, type PaletteItem } from "./palette-search";

const items: PaletteItem[] = [
    { id: "p1", kind: "project", title: "Invoice OCR fallback", subtitle: "needs you · schema question" },
    { id: "p2", kind: "project", title: "OCR vendor evaluation", subtitle: "out of the sidebar · last touched 5 weeks ago" },
    { id: "s1", kind: "session", title: "ocr-adapter", subtitle: "running · Invoice OCR fallback" },
    { id: "a1", kind: "action", title: "New session in Invoice OCR fallback", hint: "⇧⌘T" },
    { id: "a2", kind: "action", title: "PRs need attention", hint: "⇧⌘G" },
];
const ids = (q: string, list = items) => searchPalette(list, q).map((h) => h.item.id);

describe("searchPalette", () => {
    test("an empty query lists everything, grouped projects → PRs → sessions → actions", () => expect(ids("")).toEqual(["p1", "p2", "s1", "a1", "a2"]));

    test("a prefix beats a word match beats a scattered match", () => expect(ids("ocr")).toEqual(["p2", "s1", "p1", "a1"]));

    test("scattered letters still find a title (fuzzy)", () => expect(ids("prsna")).toEqual(["a2"]));

    test("case and extra spaces don't matter", () => expect(ids("  VENDOR ")).toEqual(["p2"]));

    test("subtitles are searched too, below title matches", () => expect(ids("schema")).toEqual(["p1"]));

    test("no match, nothing", () => expect(ids("zzz")).toEqual([]));
});

describe("searchPalette over a project's fields", () => {
    const project = (id: string, extra: Partial<PaletteItem> = {}): PaletteItem => ({ id, kind: "project", title: id, ...extra });
    const notes = (text: string) => ({ text, weight: 10, label: "project.md" });
    const list: PaletteItem[] = [
        project("Invoice flow", { fields: [{ text: "acme/api#13680 Fix the rounding", weight: 50, ids: true, label: "PR" }, notes("Waits for the retest of the rounding fix.")] }),
        project("Export cleanup", { fields: [notes("Nothing about rounding here, just a retest note.")], recency: 5 }),
        project("Rounding errors", { recency: 1 }),
    ];

    test("every word must match, each anywhere in the project", () => expect(ids("retest 13680", list)).toEqual(["Invoice flow"]));

    test("an exact PR number or task id comes first", () => expect(ids("#13680", list)[0]).toBe("Invoice flow"));

    test("a title match outranks the same word in the notes", () => expect(ids("rounding", list)[0]).toBe("Rounding errors"));

    test("long text needs the word itself, not scattered letters", () => expect(ids("wrtst", list)).toEqual([]));

    test("ties go to the more recent project", () => expect(ids("retest", [list[1], list[0]].map((p) => ({ ...p, fields: [notes("a retest")] })))).toEqual(["Export cleanup", "Invoice flow"]));

    test("a notes match carries a snippet around the hit, with its label", () => {
        const hit = searchPalette(list, "retest").find((h) => h.item.id === "Invoice flow")!;
        expect(hit.snippet).toEqual({ label: "project.md", before: "Waits for the ", match: "retest", after: " of the rounding fix." });
    });

    test("a long snippet is cut around the hit", () => {
        const long = `${"a ".repeat(60)}needle${" b".repeat(60)}`;
        const s = searchPalette([project("x", { fields: [notes(long)] })], "needle")[0].snippet!;
        expect([s.before.startsWith("…"), s.after.endsWith("…"), s.before.length < 40, s.after.length < 40]).toEqual([true, true, true, true]);
    });

    test("title matches are marked for highlighting", () => {
        expect(searchPalette(list, "round")[0].titleMarks).toEqual([[0, 5]]);
        expect(searchPalette([project("Export cleanup")], "excl")[0].titleMarks).toEqual([[0, 2], [7, 9]]);
    });
});

describe("groupHits", () => {
    const many = Array.from({ length: 9 }, (_, i): PaletteItem => ({ id: `p${i}`, kind: "project", title: `Project ${i}` }));
    const hits = searchPalette([...many, { id: "a", kind: "action", title: "Project action" }], "project");

    test("at most 6 a group, then a row for the rest", () => {
        const rows = groupHits(hits, new Set());
        expect(rows.filter((r) => r.type === "hit" && r.hit.item.kind === "project").length).toBe(6);
        expect(rows.find((r) => r.type === "more")).toEqual({ type: "more", kind: "project", count: 3 });
    });

    test("an expanded group shows them all", () => expect(groupHits(hits, new Set(["project"])).filter((r) => r.type === "more")).toEqual([]));

    test("groups follow their best hit, so the top row is the best result", () => {
        const rows = groupHits(searchPalette([{ id: "x", kind: "project", title: "Other" }, { id: "y", kind: "action", title: "Rename" }], "rename"), new Set());
        expect(rows[0]).toMatchObject({ type: "hit", hit: { item: { id: "y" } } });
    });
});
