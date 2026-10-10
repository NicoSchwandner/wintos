import { describe, expect, test } from "vitest";
import { keyName } from "./keyGame";

describe("keyName", () => {
    test.each([
        [{ key: "j", code: "KeyJ", cmd: true }, "⌘J"],
        [{ key: "∆", code: "KeyJ", cmd: true, option: true }, "⌥⌘J"],
        [{ key: "Y", code: "KeyY", cmd: true, shift: true }, "⇧⌘Y"],
        [{ key: "j", code: "KeyJ" }, "j"],
        [{ key: "Enter", code: "Enter" }, "⏎"],
        [{ key: "Escape", code: "Escape" }, "Esc"],
        [{ key: "Tab", code: "Tab", control: true }, "⌃⇥"],
    ])("%o reads %s", (e, out) => expect(keyName(e)).toBe(out));
});
