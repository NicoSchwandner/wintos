import { describe, expect, test } from "vitest";
import type { Session } from "../daemon/sessions/reduce";
import { attachments, closeWarning, liveSessions, paneCloseWarns, unreadSessions } from "./sessions";

const s = (id: string, tabId: string, state: Session["state"], since = 0): Session => ({ id, tabId, blockId: `b-${id}`, state, since, lastAt: since });

describe("liveSessions", () => {
    test("a session whose block was closed no longer counts", () => {
        const all = [s("1", "t", "waiting"), s("2", "t", "working")];
        expect(liveSessions(all, { t: ["b-2"] }).map((x) => x.id)).toEqual(["2"]);
    });

    test("tabs the UI knows nothing about keep nothing", () => {
        expect(liveSessions([s("1", "gone", "waiting")], { t: ["b-1"] })).toEqual([]);
    });
});

describe("closeWarning", () => {
    test("names the Claude sessions a close would stop", () => {
        const all = [s("a", "t1", "working"), s("b", "t1", "waiting"), s("c", "t2", "working"), s("d", "t1", "ended")];
        expect(closeWarning(all, "t1")).toBe("2 Claude sessions will stop");
        expect(closeWarning([s("a", "t1", "idle")], "t1")).toBe("1 Claude session will stop");
    });

    test("nothing to lose means no question", () => {
        expect(closeWarning([s("d", "t1", "ended"), s("c", "t2", "working")], "t1")).toBeNull();
    });
});

describe("paneCloseWarns", () => {
    test("the first ⌘W on a pane whose session is working only warns", () =>
        expect(paneCloseWarns([s("a", "t", "working")], "b-a", null)).toBe(true));
    test("the second ⌘W on it closes", () => expect(paneCloseWarns([s("a", "t", "working")], "b-a", "b-a")).toBe(false));
    test("a warning armed for another pane does not count", () => expect(paneCloseWarns([s("a", "t", "working")], "b-a", "b-x")).toBe(true));
    test.each(["waiting", "idle", "parked", "done", "ended"] as const)("a %s session closes at once", (state) =>
        expect(paneCloseWarns([s("a", "t", state)], "b-a", null)).toBe(false));
    test("a pane without a session closes at once", () => expect(paneCloseWarns([], "b-a", null)).toBe(false));
});

test("a session only in the background service is in no pane: never counted as live", () => {
    const s = (id: string, o = {}) => ({ id, tabId: "t", blockId: "b", state: "waiting", since: 0, lastAt: 0, ...o }) as never;
    expect(liveSessions([s("pane"), s("fork", { background: true })], { t: ["b"] }).map((x: { id: string }) => x.id)).toEqual(["pane"]);
});

test("a pane resuming a session placed elsewhere is reported; one already right, or ended, is not", () => {
    const s = (id: string, o = {}) => ({ id, tabId: "t", blockId: "old", state: "waiting", since: 0, lastAt: 0, ...o }) as never;
    const panes = [{ blockId: "v1", script: "cd '/w' && claude --resume 'fork'" }, { blockId: "v2", script: "cd '/w' && claude --resume 'here'" }, { blockId: "v3" }, { blockId: "v4", script: "claude --resume 'gone'" }];
    expect(attachments(panes, [s("fork"), s("here", { blockId: "v2" }), s("gone", { state: "ended" })], "t", new Set())).toEqual([{ sessionId: "fork", blockId: "v1" }]);
});

test("a pane attaches its session once: two panes resuming one session never take it back from each other", () => {
    const s = (o = {}) => ({ id: "fork", tabId: "other", blockId: "w1", state: "waiting", since: 0, lastAt: 0, ...o }) as never;
    const panes = [{ blockId: "v1", script: "claude --resume 'fork'" }];
    expect(attachments(panes, [s()], "t", new Set(["fork@v1"]))).toEqual([]);
});

