import { describe, expect, test } from "vitest";
import { isPlainKey, sameChord } from "./keys";

describe("isPlainKey", () => {
    test("a bare letter or digit is a view's own key", () => expect(isPlainKey({ metaKey: false, ctrlKey: false, altKey: false })).toBe(true));
    test.each(["metaKey", "ctrlKey", "altKey"])("with %s it belongs to WintOS or the app, not the view", (m) =>
        expect(isPlainKey({ metaKey: false, ctrlKey: false, altKey: false, [m]: true })).toBe(false));
});

describe("sameChord", () => {
    test("the same keys in any order of modifiers are one chord", () => {
        expect(sameChord("Shift:Cmd:w", "Cmd:Shift:w")).toBe(true);
        expect(sameChord("Cmd:w", "Cmd:w")).toBe(true);
    });
    test("different keys or modifiers are not", () => {
        expect(sameChord("Shift:Cmd:w", "Cmd:w")).toBe(false);
        expect(sameChord("Cmd:j", "Cmd:k")).toBe(false);
    });
});
