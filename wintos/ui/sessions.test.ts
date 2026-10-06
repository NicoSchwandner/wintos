import { describe, expect, test } from "vitest";
import type { Session } from "../daemon/sessions/reduce";
import { closeWarning, liveSessions, nextNeedsYou, nextWaiting, unreadSessions } from "./sessions";

const s = (id: string, tabId: string, state: Session["state"], since = 0): Session => ({ id, tabId, blockId: `b-${id}`, state, since, lastAt: since });

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

    test("when the only waiting session here is the current one, move on to another tab", () => {
        const all = [s("1", "t", "waiting", 5), s("2", "u", "waiting", 50)];
        expect(nextWaiting(all, tabs, "t", "b-1")).toEqual({ tabId: "u", blockId: "b-2" });
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

describe("nextNeedsYou", () => {
    test("a waiting session comes first", () => {
        expect(nextNeedsYou([s("a", "t2", "waiting")], ["t1", "t2"], "t1", undefined, ["t3"])).toEqual({ tabId: "t2", blockId: "b-a" });
    });

    test("with none waiting, the next project in Needs you (a PR that needs you), cycling", () => {
        expect(nextNeedsYou([], ["t1", "t2", "t3"], "t1", undefined, ["t2", "t3"])).toEqual({ tabId: "t2" });
        expect(nextNeedsYou([], ["t1", "t2", "t3"], "t3", undefined, ["t2", "t3"])).toEqual({ tabId: "t2" });
    });

    test("the open project as the only one in Needs you is still the answer (back to its terminals)", () => {
        expect(nextNeedsYou([], ["t1"], "t1", undefined, ["t1"])).toEqual({ tabId: "t1" });
    });

    test("the only waiting session is the one you're in: on to a project in Needs you for its PR", () => {
        expect(nextNeedsYou([s("a", "t1", "waiting")], ["t1", "t2"], "t1", "b-a", ["t1", "t2"])).toEqual({ tabId: "t2" });
        // and from there, back to the waiting session
        expect(nextNeedsYou([s("a", "t1", "waiting")], ["t1", "t2"], "t2", undefined, ["t1", "t2"])).toEqual({ tabId: "t1", blockId: "b-a" });
        // nothing else needs you: it stays on the session
        expect(nextNeedsYou([s("a", "t1", "waiting")], ["t1"], "t1", "b-a", ["t1"])).toEqual({ tabId: "t1", blockId: "b-a" });
    });

    test("nothing needs you, nowhere to go", () => {
        expect(nextNeedsYou([], ["t1"], "t1", undefined, [])).toBeNull();
    });
});

describe("unreadSessions", () => {
    const e = (id: string, tabId: string, state: Session["state"], turnEndedAt?: number): Session => ({ ...s(id, tabId, state), turnEndedAt });

    test("sessions of this tab whose last turn ended after you last looked", () => {
        const all = [e("a", "t1", "done", 50), e("b", "t1", "working", 10), e("c", "t2", "done", 50), e("d", "t1", "ended", 60)];
        expect(unreadSessions(all, "t1", 20).map((x) => x.id)).toEqual(["a"]);
        expect(unreadSessions(all, "t1", undefined).map((x) => x.id)).toEqual(["a", "b"]);
    });
});
