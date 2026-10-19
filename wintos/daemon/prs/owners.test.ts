import { describe, expect, test } from "vitest";
import type { Session } from "../sessions/reduce";
import type { Shelf } from "../shelf/shelf";
import { reassignPrs, touchPrs } from "./owners";

const s = (id: string, prs: string[]): Session => ({ id, tabId: "t", blockId: `b-${id}`, state: "waiting", since: 0, lastAt: 0, prs });
const shelved = (id: string, prs: string[]) => ({ sessionId: id, script: "x", label: "l", at: 0, prs });

describe("reassignPrs (a one-off rebuild of who owns which PR)", () => {
    test("each PR ends up with its one owner, live or shelved; null leaves it with nobody; the rest stay", () => {
        const sessions = new Map([["a", s("a", ["u1", "u2", "keep"])], ["b", s("b", [])]]);
        const shelf: Shelf = { p: [shelved("z", ["u3"])] };
        const r = reassignPrs(sessions, shelf, { u1: "b", u2: null, u3: "a", u4: "z" });
        expect([r.sessions.get("a")!.prs, r.sessions.get("b")!.prs, r.shelf.p[0].prs]).toEqual([["keep", "u3"], ["u1"], ["u4"]]);
    });

    test("an owner WintOS doesn't know is left out, and the PR keeps its old owner", () => {
        const r = reassignPrs(new Map([["a", s("a", ["u1"])]]), {}, { u1: "gone" });
        expect(r.sessions.get("a")!.prs).toEqual(["u1"]);
    });
});

describe("touchPrs (who owns a PR, and where else it is)", () => {
    test("the first session to touch a PR owns it; a later one gets it as also-in", () => {
        let r = touchPrs(new Map([["a", s("a", [])], ["b", s("b", [])]]), {}, "a", ["u1"]);
        r = touchPrs(r.sessions, r.shelf, "b", ["u1", "u2"]);
        expect([r.sessions.get("a")!.prs, r.sessions.get("b")!.prs, r.sessions.get("b")!.touched]).toEqual([["u1"], ["u2"], ["u1"]]);
    });

    test("a shelved owner keeps its PR when another session touches it", () => {
        const r = touchPrs(new Map([["b", s("b", [])]]), { p: [shelved("z", ["u1"])] }, "b", ["u1"]);
        expect([r.shelf.p[0].prs, r.sessions.get("b")!.prs, r.sessions.get("b")!.touched]).toEqual([["u1"], [], ["u1"]]);
    });

    test("taking it over (`wintos pr --own`) moves the PR; the old owner, live or shelved, keeps it as also-in", () => {
        const r = touchPrs(new Map([["a", s("a", ["u1"])], ["b", { ...s("b", []), touched: ["u1", "u2"] }]]), { p: [shelved("z", ["u2"])] }, "b", ["u1", "u2"], true);
        expect([r.sessions.get("b")!.prs, r.sessions.get("b")!.touched, r.sessions.get("a")!.prs, r.sessions.get("a")!.touched, r.shelf.p[0].prs, r.shelf.p[0].touched]).toEqual([["u1", "u2"], [], [], ["u1"], [], ["u2"]]);
    });

    test("a PR the session already owns, or an unknown session, changes nothing", () => {
        const sessions = new Map([["a", s("a", ["u1"])]]);
        expect(touchPrs(sessions, {}, "a", ["u1"]).sessions.get("a")).toMatchObject({ prs: ["u1"], touched: [] });
        expect(touchPrs(sessions, {}, "nobody", ["u1"]).sessions).toBe(sessions);
    });
});
