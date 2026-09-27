import { describe, expect, test } from "vitest";
import { injection } from "./inject";

describe("injection", () => {
    test("an unreadable note asks for a repair, never for a title (which would overwrite it)", () => {
        const text = injection({ id: "t", dir: "/p/x", mtime: 0, error: "no front matter" }, { text: "mine" });
        expect(text).not.toContain("wintos title");
        expect(text).toContain("/p/x/project.md is unreadable (no front matter)");
    });

    test("a titled project gets the section formats the notes view renders", () => {
        const text = injection({ id: "t", title: "X", dir: "/p/x", mtime: 0, pr: [], titleLocked: false, body: "" }, { text: "m" });
        for (const marker of ["- 19 sep — ", "- [x]", "- [~]", "- [ ]", "(blocking)"]) expect(text).toContain(marker);
    });

    test("no project at all asks for a title", () => {
        expect(injection(undefined, { text: "mine.md is empty" })).toContain('wintos title "');
    });
});
