import { describe, expect, test } from "vitest";
import { inputAfter } from "./focusRing";

describe("inputAfter: which input you are using now", () => {
    test("a click on WintOS's own interface is the mouse", () => expect(inputAfter({ kind: "pointer", inPane: false })).toBe("mouse"));
    test("a click inside a pane (a terminal, a page) changes nothing: keyboard work clicks there too", () => expect(inputAfter({ kind: "pointer", inPane: true })).toBeUndefined());
    test("a shortcut is the keyboard, typing or not", () => {
        expect(inputAfter({ kind: "key", key: "j", mods: true, typing: true })).toBe("keyboard");
        expect(inputAfter({ kind: "key", key: "j", mods: true, typing: false })).toBe("keyboard");
    });
    test("a key outside a text field (j in a list, Esc) is the keyboard; typing is neither", () => {
        expect(inputAfter({ kind: "key", key: "j", mods: false, typing: false })).toBe("keyboard");
        expect(inputAfter({ kind: "key", key: "j", mods: false, typing: true })).toBeUndefined();
    });
    test("a modifier pressed alone decides nothing yet", () => expect(inputAfter({ kind: "key", key: "Meta", mods: true, typing: false })).toBeUndefined());
});
