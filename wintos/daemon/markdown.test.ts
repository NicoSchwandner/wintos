import { describe, expect, test } from "vitest";
import { formatMarkdown } from "./markdown";

describe("formatMarkdown", () => {
    test("tidies a list typed by hand, keeping its nesting", async () =>
        expect(await formatMarkdown("-  [ ] Ship it\n\t- [ ] the fallback\n- [x] Review")).toBe("- [ ] Ship it\n  - [ ] the fallback\n- [x] Review\n"));
    test("leaves long lines unwrapped", async () => {
        const line = `- [ ] ${"word ".repeat(40).trim()}\n`;
        expect(await formatMarkdown(line)).toBe(line);
    });
});
