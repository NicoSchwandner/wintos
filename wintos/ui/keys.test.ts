import { describe, expect, test } from "vitest";
import { isPlainKey } from "./keys";

describe("isPlainKey", () => {
    test("a bare letter or digit is a view's own key", () => expect(isPlainKey({ metaKey: false, ctrlKey: false, altKey: false })).toBe(true));
    test.each(["metaKey", "ctrlKey", "altKey"])("with %s it belongs to WintOS or the app, not the view", (m) =>
        expect(isPlainKey({ metaKey: false, ctrlKey: false, altKey: false, [m]: true })).toBe(false));
});
