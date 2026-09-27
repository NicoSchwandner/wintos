import { describe, expect, test } from "vitest";
import type { Session } from "../daemon/sessions/reduce";
import { nextWaiting, stripSessions } from "./sessions";

const s = (id: string, tabId: string, state: Session["state"], since = 0): Session => ({ id, tabId, blockId: `b-${id}`, state, since, lastAt: since });

describe("stripSessions", () => {
    test("the active tab's live sessions, in the order first seen", () => {
        const all = [s("1", "t", "working"), s("2", "u", "waiting"), s("3", "t", "ended"), s("4", "t", "waiting")];
        expect(stripSessions(all, "t").map((x) => x.id)).toEqual(["1", "4"]);
    });
});

describe("nextWaiting", () => {
    const tabs = ["t", "u", "v"];

    test("cycles to the next waiting session in this tab after the current block", () => {
        const all = [s("1", "t", "waiting"), s("2", "t", "working"), s("3", "t", "waiting")];
        expect(nextWaiting(all, tabs, "t", "b-1")).toEqual({ tabId: "t", blockId: "b-3" });
        expect(nextWaiting(all, tabs, "t", "b-3")).toEqual({ tabId: "t", blockId: "b-1" });
    });

    test("with nothing else waiting here, goes to the longest wait in another tab", () => {
        const all = [s("1", "t", "working"), s("2", "u", "waiting", 50), s("3", "v", "waiting", 10)];
        expect(nextWaiting(all, tabs, "t", "b-1")).toEqual({ tabId: "v", blockId: "b-3" });
    });

    test("the only waiting session is the current one: stay", () => {
        expect(nextWaiting([s("1", "t", "waiting")], tabs, "t", "b-1")).toEqual({ tabId: "t", blockId: "b-1" });
    });

    test("tabs outside the workspace are never targets", () => {
        expect(nextWaiting([s("1", "gone", "waiting")], tabs, "t", undefined)).toBeNull();
    });

    test("nothing waiting anywhere", () => {
        expect(nextWaiting([s("1", "t", "working")], tabs, "t", "b-1")).toBeNull();
    });
});
