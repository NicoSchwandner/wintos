import { describe, expect, test } from "vitest";
import { stepProject } from "./switcher";

describe("stepProject", () => {
    const order = ["a", "b", "c"];

    test("moves down and up the ranked order", () => {
        expect(stepProject(order, "a", 1)).toBe("b");
        expect(stepProject(order, "b", -1)).toBe("a");
    });

    test("wraps at both ends", () => {
        expect(stepProject(order, "c", 1)).toBe("a");
        expect(stepProject(order, "a", -1)).toBe("c");
    });

    test("a current tab missing from the order starts at the top or bottom", () => {
        expect(stepProject(order, "x", 1)).toBe("a");
        expect(stepProject(order, "x", -1)).toBe("c");
    });

    test("an empty order has nowhere to go", () => {
        expect(stepProject([], "a", 1)).toBeUndefined();
    });
});
