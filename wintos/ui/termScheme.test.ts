import { describe, expect, test } from "vitest";
import { backgroundReply, schemeReport } from "./termScheme";

describe("terminal colour scheme", () => {
    test("OSC 11 reply carries the background without its transparency", () => {
        expect(backgroundReply("#fbfaf680")).toBe("\x1b]11;rgb:fbfb/fafa/f6f6\x1b\\");
        expect(backgroundReply("#141311")).toBe("\x1b]11;rgb:1414/1313/1111\x1b\\");
    });
    test("the scheme report: 1 for dark, 2 for light", () => {
        expect(schemeReport("#141311")).toBe("\x1b[?997;1n");
        expect(schemeReport("#fbfaf680")).toBe("\x1b[?997;2n");
    });
});
