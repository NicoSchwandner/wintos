import { describe, expect, test } from "vitest";
import type { Session } from "../daemon/sessions/reduce";
import { paneOrder, stripPanes } from "./panes";

const block = (oid: string, meta: Record<string, unknown>) => ({ oid, meta }) as unknown as Block;
const session = (id: string, blockId: string, state: Session["state"], label?: string): Session => ({ id, tabId: "t", blockId, state, since: 5, lastAt: 5, label });

describe("stripPanes", () => {
    test("every pane of the tab, in layout order, named by what it shows", () => {
        const blocks = [
            block("b1", { view: "term" }),
            block("b2", { view: "term" }),
            block("b3", { view: "web", url: "https://github.com/acme/api/pull/42/files" }),
            block("b4", { view: "web", url: "https://status.example.com/x" }),
        ];
        const chips = stripPanes(blocks, [session("s1", "b1", "waiting", "fix the parser")]);
        expect(chips.map((c) => [c.blockId, c.kind, c.label])).toEqual([
            ["b1", "session", "fix the parser"],
            ["b2", "terminal", "terminal"],
            ["b3", "web", "api #42"],
            ["b4", "web", "status.example.com"],
        ]);
        expect(chips[0].session?.state).toBe("waiting");
    });

    test("an ended session's pane is a plain terminal again", () => {
        expect(stripPanes([block("b1", { view: "term" })], [session("s1", "b1", "ended")])[0].kind).toBe("terminal");
    });

    test("a pane not loaded yet is skipped", () => expect(stripPanes([undefined as unknown as Block], [])).toEqual([]));
});

describe("paneOrder", () => {
    test("panes follow the layout, left to right, as the eye reads them", () =>
        expect(paneOrder([{ nodeid: "n2", blockid: "b2" }, { nodeid: "n1", blockid: "b1" }], ["b1", "b2"])).toEqual(["b2", "b1"]));
    test("a block not laid out yet comes last, and a stale leaf is dropped", () =>
        expect(paneOrder([{ nodeid: "n9", blockid: "gone" }, { nodeid: "n2", blockid: "b2" }], ["b1", "b2"])).toEqual(["b2", "b1"]));
});
