import { describe, expect, test } from "vitest";
import type { Session } from "../daemon/sessions/reduce";
import { closeWarning, liveSessions, nextNeedsYou, unreadSessions } from "./sessions";

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

describe("nextNeedsYou", () => {
    // Needs you, top to bottom: t1 (two waiting sessions), t2 (one), t3 (there for a PR).
    const all = [s("a", "t1", "waiting", 1), s("b", "t1", "waiting", 2), s("c", "t2", "waiting", 3), s("w", "t2", "working")];
    const tabs = ["t0", "t1", "t2", "t3"];
    const needs = ["t1", "t2", "t3"];
    const next = (tab: string, block?: string) => nextNeedsYou(all, tabs, tab, block, needs);

    test("walks Needs you in its order, each waiting session a stop, and wraps", () => {
        expect(next("t1", "b-a")).toEqual({ tabId: "t1", blockId: "b-b" });
        expect(next("t1", "b-b")).toEqual({ tabId: "t2", blockId: "b-c" });
        expect(next("t2", "b-c")).toEqual({ tabId: "t3" });
        expect(next("t3")).toEqual({ tabId: "t1", blockId: "b-a" });
    });

    test("every project is reached, however many need you", () => {
        const seen = new Set<string>();
        let at: { tabId: string; blockId?: string } = { tabId: "t1", blockId: "b-a" };
        for (let i = 0; i < 4; i++) (at = next(at.tabId, at.blockId)!), seen.add(at.tabId);
        expect([...seen].sort()).toEqual(["t1", "t2", "t3"]);
    });

    test("in a listed project but not on one of its waiting sessions: that project's first", () => {
        expect(next("t2", "b-w")).toEqual({ tabId: "t2", blockId: "b-c" });
    });

    test("from anywhere else, the top of Needs you", () => {
        expect(next("t0")).toEqual({ tabId: "t1", blockId: "b-a" });
        expect(next("card:prs")).toEqual({ tabId: "t1", blockId: "b-a" });
    });

    test("a waiting session in a project not in Needs you still counts, after the list", () => {
        expect(nextNeedsYou([s("z", "t0", "waiting")], tabs, "t3", undefined, ["t3"])).toEqual({ tabId: "t0", blockId: "b-z" });
    });

    test("the only stop is where you are: stay", () => {
        expect(nextNeedsYou([s("a", "t1", "waiting")], tabs, "t1", "b-a", ["t1"])).toEqual({ tabId: "t1", blockId: "b-a" });
        expect(nextNeedsYou([], ["t1"], "t1", undefined, ["t1"])).toEqual({ tabId: "t1" });
    });

    test("tabs outside the workspace are never stops; nothing needs you, nowhere to go", () => {
        expect(nextNeedsYou([s("1", "gone", "waiting")], ["t1"], "t1", undefined, [])).toBeNull();
    });
});
