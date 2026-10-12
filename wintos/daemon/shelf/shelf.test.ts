import { describe, expect, test } from "vitest";
import { releasePrs, resumedSession, shelve, unshelve, type Shelf } from "./shelf";

const item = (sessionId: string, at: number) => ({ sessionId, script: `cd '/w' && claude --resume '${sessionId}'`, label: sessionId, at });
const DAY = 86_400_000;

describe("resumedSession", () => {
    test("the hook's resume command, with or without another account", () => {
        expect(resumedSession("cd '/Users/me/it'\\''s' && claude --resume '0a1b-2c'")).toBe("0a1b-2c");
        expect(resumedSession("cd '/w' && CLAUDE_CONFIG_DIR='/c' claude --resume 'abc'")).toBe("abc");
    });
    test("anything else is never run later", () => {
        expect(resumedSession("cd '/w' && claude --resume 'abc'; rm -rf ~")).toBeUndefined();
        expect(resumedSession("cd '/w' && claude")).toBeUndefined();
        expect(resumedSession("")).toBeUndefined();
    });
});

describe("the shelf", () => {
    test("newest first per project folder; shelving again moves it up", () => {
        let s: Shelf = {};
        s = shelve(s, "idea", item("a", 1), 14);
        s = shelve(s, "idea", item("b", 2), 14);
        s = shelve(s, "idea", item("a", 3), 14);
        expect(s.idea.map((i) => i.sessionId)).toEqual(["a", "b"]);
    });
    test("entries older than the kept days go", () => {
        const s = shelve({ idea: [item("old", 0)], other: [item("x", 0)] }, "idea", item("new", 15 * DAY), 14);
        expect(s).toEqual({ idea: [item("new", 15 * DAY)] });
    });
    test("a session that runs again leaves the shelf, wherever it was", () => {
        expect(unshelve({ idea: [item("a", 1), item("b", 1)], other: [item("a", 1)] }, "a")).toEqual({ idea: [item("b", 1)] });
    });
});

describe("releasePrs", () => {
    const A = "https://github.com/o/r/pull/1", B = "https://github.com/o/r/pull/2";
    const shelf: Shelf = { p: [{ sessionId: "s", script: "x", label: "l", at: 1, prs: [A, B] }] };
    test("a PR another session took leaves the shelved one that had it", () => expect(releasePrs(shelf, [A]).p[0].prs).toEqual([B]));
    test("nothing changes, the same shelf comes back", () => expect(releasePrs(shelf, ["https://github.com/o/r/pull/9"])).toBe(shelf));
});
