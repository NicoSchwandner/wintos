import { describe, expect, test } from "vitest";
import type { Session } from "../daemon/sessions/reduce";
import type { WintosState } from "../ui/view";
import { deliveries, sidebar } from "./model";

const NOW = 1_000_000;
const s = (id: string, tabId: string, o: Partial<Session>) => ({ id, tabId, blockId: `t-${id}`, since: NOW - 10, lastAt: NOW - 10, ...o }) as Session;
const projects = ["a", "b", "c"].map((id) => ({ id, title: id.toUpperCase(), dir: `/${id}`, mtime: 0 }) as never);

describe("the Herdr sidebar", () => {
    const state = { now: NOW, projects, driving: ["c"], sessions: [s("1", "a", { state: "waiting" }), s("2", "b", { state: "working" }), s("3", "c", { state: "waiting", since: NOW - 50 }), s("4", "c", { state: "working" })] } as WintosState;
    const m = sidebar(state, ["a", "b", "c"], {}, NOW);
    test("driving first, then the bands, each row with its view and where a click lands", () => {
        expect([m.driving.map((d) => d.tabId), m.needs.map((r) => [r.tabId, r.view.title, r.target?.blockId]), m.running.map((r) => r.tabId)]).toEqual([["c"], [["a", "A", "t-1"]], ["b"]]);
    });
    test("agent.next goes to what waits in the driving projects, then to Your move; nothing running", () => {
        expect(m.order).toEqual(["t-3", "t-1"]);
    });
});

describe("wakes in Herdr", () => {
    test("each tab's due wake for its idle session, typed into its terminal", () => {
        const wakes = { w: { sessionId: "1", pr: "https://github.com/o/r/pull/7", until: "merged", prompt: "go on", due: NOW } } as never;
        const state = { now: NOW, projects, wakes, sessions: [s("1", "a", { state: "idle" })] } as WintosState;
        expect(deliveries(state, ["a", "b"]).map((d) => [d.kind, d.tabId, "blockId" in d && d.blockId])).toEqual([["type", "a", "t-1"]]);
    });
});
