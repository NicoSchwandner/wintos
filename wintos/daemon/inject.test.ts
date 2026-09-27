import { describe, expect, test } from "vitest";
import { injection } from "./inject";

describe("injection", () => {
    test("an unreadable note asks for a repair, never for a title (which would overwrite it)", () => {
        const text = injection({ id: "t", dir: "/p/x", mtime: 0, error: "no front matter" }, { text: "mine" });
        expect(text).not.toContain("wintos title");
        expect(text).toContain("/p/x/project.md is unreadable (no front matter)");
    });

    test("no project at all asks for a title", () => {
        expect(injection(undefined, { text: "mine.md is empty" })).toContain('wintos title "');
    });
});
