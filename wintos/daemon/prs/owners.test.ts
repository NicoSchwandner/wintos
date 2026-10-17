import { describe, expect, test } from "vitest";
import type { Session } from "../sessions/reduce";
import type { Shelf } from "../shelf/shelf";
import { reassignPrs } from "./owners";

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
