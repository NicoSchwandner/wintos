import { describe, expect, test } from "vitest";
import { toggleCheckbox } from "./checkbox";

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
