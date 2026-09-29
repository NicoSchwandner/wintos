import { describe, expect, test } from "vitest";
import { checkbox, toggleCheckbox } from "./checkbox";

describe("checkbox", () => {
    test("reads a task line, any bullet, any indent", () => {
        expect(checkbox("- [ ] Test-run with Anton")).toEqual({ state: "todo", text: "Test-run with Anton" });
        expect(checkbox("  * [x] done")).toEqual({ state: "done", text: "done" });
        expect(checkbox("- [X] done")).toEqual({ state: "done", text: "done" });
        expect(checkbox("- [~] half")).toEqual({ state: "partial", text: "half" });
    });

    test("anything else is not a checkbox", () => {
        expect(checkbox("- a bullet")).toBeUndefined();
        expect(checkbox("[ ] no bullet")).toBeUndefined();
    });
});

describe("toggleCheckbox", () => {
    const md = "# Mine\n- [ ] one\n- [x] two\nplain";

    test("ticks and unticks only that line, keeping the rest byte for byte", () => {
        expect(toggleCheckbox(md, 1)).toBe("# Mine\n- [x] one\n- [x] two\nplain");
        expect(toggleCheckbox(md, 2)).toBe("# Mine\n- [ ] one\n- [ ] two\nplain");
    });

    test("a partial one becomes done; a non-checkbox line is left alone", () => {
        expect(toggleCheckbox("- [~] half", 0)).toBe("- [x] half");
        expect(toggleCheckbox(md, 3)).toBe(md);
    });
});
