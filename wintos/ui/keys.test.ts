import { describe, expect, test } from "vitest";
import { sameChord } from "./keys";

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
