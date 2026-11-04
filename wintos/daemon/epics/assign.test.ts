import { describe, expect, test } from "vitest";
import type { Session } from "../sessions/reduce";
import { impliedEpic } from "./assign";
import type { Epic } from "./epics";

const s = (id: string, tabId: string, lastAt: number, more: Partial<Session> = {}): Session => ({ id, tabId, blockId: `b-${id}`, state: "idle", since: 0, lastAt, ...more }) as Session;
const epics: Epic[] = [
    { id: "route", title: "Route", steps: [] },
    { id: "reviews", title: "Reviews", lane: "review", steps: [] },
    { id: "old", title: "Old", steps: [], done: "2026-10-01" },
];

describe("impliedEpic", () => {
    test("a session takes the epic of the newest session beside it", () => {
        const all = [s("a", "t1", 1, { epic: "reviews" }), s("b", "t1", 5, { epic: "route" }), s("new", "t1", 9)];
        expect(impliedEpic(all[2], all, epics)).toBe("route");
    });
    test("sessions in other tabs don't count", () => {
        const all = [s("a", "t2", 5, { epic: "route" }), s("new", "t1", 9)];
        expect(impliedEpic(all[1], all, epics)).toBeUndefined();
    });
    test("a finished epic is not inherited", () => {
        const all = [s("a", "t1", 5, { epic: "old" }), s("new", "t1", 9)];
        expect(impliedEpic(all[1], all, epics)).toBeUndefined();
    });
    test("with none beside it, the lane decides", () => {
        const fresh = s("new", "t1", 9, { lane: { name: "review", steps: ["Read"], at: 0 } as Session["lane"] });
        expect(impliedEpic(fresh, [fresh], epics)).toBe("reviews");
    });
    test("a lane no epic claims leaves it unassigned", () => {
        const fresh = s("new", "t1", 9, { lane: { name: "feature", steps: ["Spec"], at: 0 } as Session["lane"] });
        expect(impliedEpic(fresh, [fresh], epics)).toBeUndefined();
    });
});
