import { describe, expect, test } from "vitest";
import { COLORS, GLYPHS, lookOf, shortName } from "./epicLook";

describe("lookOf", () => {
    test("the glyph and colour epic.md names", () => expect(lookOf({ id: "a", glyph: "route", color: "teal" })).toMatchObject({ glyph: "route", d: GLYPHS.route, fg: "var(--w-epic-teal)", bg: "var(--w-epic-teal-bg)" }));
    test("left out, they come from the id, the same every time", () => {
        const a = lookOf({ id: "coder-task-force" });
        expect(lookOf({ id: "coder-task-force" })).toEqual(a);
        expect(Object.keys(GLYPHS)).toContain(a.glyph);
        expect(COLORS).toContain(a.color);
    });
    test("an unknown glyph or colour is picked as if left out", () => {
        const picked = lookOf({ id: "x" });
        expect(lookOf({ id: "x", glyph: "unicorn", color: "plaid" })).toEqual(picked);
    });
    test("a review epic looks at things, a support epic warns", () => {
        expect(lookOf({ id: "r", lane: "review" }).glyph).toBe("eye");
        expect(lookOf({ id: "s", lane: "support" }).glyph).toBe("alert");
    });
});

test("shortName: the short name, else the title", () => {
    expect(shortName({ title: "Route all incoming documents", short: "Route DO" })).toBe("Route DO");
    expect(shortName({ title: "Reviews" })).toBe("Reviews");
});
