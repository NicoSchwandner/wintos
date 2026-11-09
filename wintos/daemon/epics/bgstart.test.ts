import { describe, expect, test } from "vitest";
import type { Session } from "../sessions/reduce";
import { bgState, liveStarts, mergeBg, NEVER_SEEN_MS, parseAgents, pruneStarts } from "./bgstart";

const start = { epic: "e", step: "Cutover", name: "Route: Cutover", agent: "ag", tabId: "t1", at: 0 };
const agent = (state: string, status?: string) => ({ id: "430f7f7e", sessionId: "430f7f7e-9d03", state, status });

describe("the background service's listing", () => {
    test("read as working, waiting on you, done, or gone", () => {
        expect(bgState({ id: "a", sessionId: "a", state: "working", status: "busy" })).toBe("working");
        expect(bgState({ id: "a", sessionId: "a", state: "blocked" })).toBe("waiting");
        expect(bgState({ id: "a", sessionId: "a", state: "done", status: "idle" })).toBe("done");
        expect(bgState(undefined)).toBe("ended");
    });
    test("a broken listing reads as none", () => {
        expect(parseAgents("{oops")).toEqual([]);
        expect(parseAgents(JSON.stringify([{ id: "x", sessionId: "x-1", state: "done" }, { pid: 3 }]))).toEqual([{ id: "x", sessionId: "x-1", state: "done" }]);
    });
});

describe("mergeBg", () => {
    test("a started session appears once listed, in its epic, named for its step; nothing before", () => {
        expect(mergeBg(new Map(), { "430f7f7e": start }, [], 5).fresh).toEqual([]);
        const r = mergeBg(new Map(), { "430f7f7e": start }, [agent("working", "busy")], 5);
        expect(r.fresh).toEqual([{ id: "430f7f7e-9d03", start }]);
        expect(r.sessions.get("430f7f7e-9d03")).toMatchObject({ state: "working", background: true, bgId: "430f7f7e", epic: "e", tabId: "t1", name: { text: "Route: Cutover" } });
    });
    test("a state change is a move to report; blocked waits on you; gone is ended, once", () => {
        const one = mergeBg(new Map(), { "430f7f7e": start }, [agent("working", "busy")], 5).sessions;
        const blocked = mergeBg(one, { "430f7f7e": start }, [agent("blocked")], 9);
        expect(blocked.moved).toEqual(["430f7f7e-9d03"]);
        expect(blocked.sessions.get("430f7f7e-9d03")).toMatchObject({ state: "waiting", ask: { kind: "answer" } });
        expect(mergeBg(blocked.sessions, { "430f7f7e": start }, [agent("blocked")], 12).moved).toEqual([]);
        const gone = mergeBg(blocked.sessions, { "430f7f7e": start }, [], 15);
        expect(gone.sessions.get("430f7f7e-9d03")?.state).toBe("ended");
        expect(mergeBg(gone.sessions, { "430f7f7e": start }, [], 20).moved).toEqual([]);
    });
    test("a session the service lists runs: a not-started mark on it goes with its next move", () => {
        const one = mergeBg(new Map(), { "430f7f7e": start }, [agent("working", "busy")], 5).sessions;
        const marked = new Map([["430f7f7e-9d03", { ...one.get("430f7f7e-9d03")!, restored: true }]]);
        expect(mergeBg(marked, { "430f7f7e": start }, [agent("done", "idle")], 9).sessions.get("430f7f7e-9d03")?.restored).toBeUndefined();
    });
    test("running starts are counted per epic", () => {
        const s = mergeBg(new Map(), { "430f7f7e": start }, [agent("working", "busy")], 5).sessions;
        expect(liveStarts({ "430f7f7e": start }, s, "e")).toBe(1);
        expect(liveStarts({ "430f7f7e": start }, s, "other")).toBe(0);
        expect(liveStarts({ "430f7f7e": start }, new Map([["430f7f7e-9d03", { ...s.get("430f7f7e-9d03")!, state: "ended" } as Session]]), "e")).toBe(0);
    });
});

test("pruneStarts: an ended session and one never listed within a day stop the polling", () => {
    const sess = (bgId: string, state: Session["state"]) => [bgId, { id: bgId, bgId, state } as Session] as const;
    const starts = { aaaaaaaa: start, bbbbbbbb: start, cccccccc: { ...start, at: 0 }, dddddddd: { ...start, at: NEVER_SEEN_MS } };
    const sessions = new Map([sess("aaaaaaaa", "working"), sess("bbbbbbbb", "ended")]);
    expect(Object.keys(pruneStarts(starts, sessions, NEVER_SEEN_MS + 1))).toEqual(["aaaaaaaa", "dddddddd"]);
});
