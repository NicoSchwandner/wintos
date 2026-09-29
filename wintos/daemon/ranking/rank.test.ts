import { describe, expect, test } from "vitest";
import type { Session } from "../sessions/reduce";
import { QUIET_CAP, rank, STALE_MS } from "./rank";

const DAY = 86_400_000;
const NOW = 100 * DAY;
const s = (tabId: string, state: Session["state"], at: number, id = `${tabId}-${state}-${at}`): Session => ({
    id, tabId, blockId: `${id}-b`, state, since: at, lastAt: at,
});

describe("rank", () => {
    test("a session that said it is done is quiet, not needs-you", () => {
        const r = rank(["t"], [s("t", "done", NOW - 5)], NOW);
        expect([r.needs, r.running, r.quiet.map((x) => x.tabId)]).toEqual([[], [], ["t"]]);
    });

    test("waiting beats working inside one project", () => {
        const r = rank(["t"], [s("t", "waiting", NOW - 5), s("t", "working", NOW - 1)], NOW);
        expect(r.needs.map((x) => x.tabId)).toEqual(["t"]);
        expect(r.running).toEqual([]);
    });

    test("needs you sorts the longest wait first", () => {
        const r = rank(["new", "old"], [s("new", "waiting", NOW - 10), s("old", "waiting", NOW - 1000)], NOW);
        expect(r.needs.map((x) => x.tabId)).toEqual(["old", "new"]);
        expect(r.needs[0].waitingSince).toBe(NOW - 1000);
    });

    test("running and quiet sort by latest activity", () => {
        const r = rank(
            ["a", "b", "c", "d"],
            [s("a", "working", NOW - 50), s("b", "working", NOW - 5), s("c", "idle", NOW - 500), s("d", "ended", NOW - 50)],
            NOW
        );
        expect(r.running.map((x) => x.tabId)).toEqual(["b", "a"]);
        expect(r.quiet.map((x) => x.tabId)).toEqual(["d", "c"]);
    });

    test("quiet shows the cap, hides the rest, drops the stale", () => {
        const tabs = Array.from({ length: 9 }, (_, i) => `q${i}`);
        const sessions = tabs.map((t, i) => s(t, "idle", i < 2 ? NOW - 15 * DAY : NOW - i * 1000));
        const r = rank(tabs, sessions, NOW);
        expect(r.quiet).toHaveLength(QUIET_CAP);
        expect(r.quietMore).toHaveLength(1);
        expect(r.quietStale.map((x) => x.tabId).sort()).toEqual(["q0", "q1"]);
    });

    test("stale means older than 14 days, not equal", () => {
        const r = rank(["edge"], [s("edge", "idle", NOW - STALE_MS)], NOW);
        expect(r.quiet.map((x) => x.tabId)).toEqual(["edge"]);
    });

    test("a tab nothing is known about is quiet and visible, never stale", () => {
        const r = rank(["fresh"], [], NOW);
        expect(r.quiet).toEqual([{ tabId: "fresh", band: "quiet", lastAt: 0, sessions: [] }]);
        expect(r.quietStale).toEqual([]);
    });

    test("activity from the project file counts as a touch", () => {
        const r = rank(["t"], [s("t", "idle", NOW - 20 * DAY)], NOW, { t: NOW - DAY });
        expect(r.quiet[0].lastAt).toBe(NOW - DAY);
    });

    test("a PR that needs you lifts a quiet project into needs you", () => {
        const r = rank(["t"], [s("t", "idle", NOW - 5)], NOW, {}, { t: NOW - 3 * DAY });
        expect(r.needs.map((x) => [x.tabId, x.waitingSince])).toEqual([["t", NOW - 3 * DAY]]);
    });

    test("the older of a waiting session and a rotting PR sets the wait", () => {
        const r = rank(["t"], [s("t", "waiting", NOW - 10)], NOW, {}, { t: NOW - DAY });
        expect(r.needs[0].waitingSince).toBe(NOW - DAY);
    });

    test("sessions of tabs outside the workspace are ignored", () => {
        const r = rank(["t"], [s("gone", "waiting", NOW)], NOW);
        expect(r.needs).toEqual([]);
    });
});

describe("parked sessions", () => {
    test("a session parked on CI runs; it is not waiting on you", () => {
        const r = rank(["t1"], [s("t1", "parked", NOW - 1000)], NOW);
        expect(r.running.map((x) => x.tabId)).toEqual(["t1"]);
        expect(r.needs).toEqual([]);
    });
});

describe("unread", () => {
    const ended = (tabId: string, state: Session["state"], turnEndedAt: number): Session => ({ ...s(tabId, state, turnEndedAt), turnEndedAt });

    test("a reply you haven't seen keeps the project in Needs you, whatever the session's state", () => {
        const r = rank(["t"], [ended("t", "done", NOW - 50)], NOW, {}, {}, { t: NOW - 100 });
        expect(r.needs).toEqual([expect.objectContaining({ tabId: "t", unread: true, waitingSince: NOW - 50 })]);
    });

    test("once seen, it falls to where it belongs: done is quiet, parked is running", () => {
        expect(rank(["t"], [ended("t", "done", NOW - 50)], NOW, {}, {}, { t: NOW - 10 }).quiet.map((x) => x.tabId)).toEqual(["t"]);
        expect(rank(["t"], [ended("t", "parked", NOW - 50)], NOW, {}, {}, { t: NOW - 10 }).running.map((x) => x.tabId)).toEqual(["t"]);
    });

    test("never seen at all counts as unread; an ended session's last reply does not", () => {
        expect(rank(["t"], [ended("t", "done", NOW - 50)], NOW).needs[0]?.unread).toBe(true);
        expect(rank(["t"], [ended("t", "ended", NOW - 50)], NOW).needs).toEqual([]);
    });
});
