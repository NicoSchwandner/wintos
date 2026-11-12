import { expect, test } from "vitest";
import type { Session } from "../sessions/reduce";
import { ownerOf } from "./handoff";

const PR = "https://github.com/o/r/pull/1";
const s = (o: Partial<Session>): Session => ({ id: "s1", tabId: "t", blockId: "b", state: "idle", since: 1, lastAt: 1, prs: [PR], cwd: "/w", ...o });

test("routes: a pane, the background, paused in its pane, ended or shelved resumed headless, else none", () => {
    expect(ownerOf(PR, [s({})], {}).route).toBe("pane");
    expect(ownerOf(PR, [s({ bgId: "ab12cd34" })], {}).route).toBe("background");
    expect(ownerOf(PR, [s({ bgId: "ab12cd34", attachedTo: "b" })], {}).route).toBe("pane");
    expect(ownerOf(PR, [s({ restored: true, paused: 1 })], {})).toMatchObject({ route: "paused", script: "cd '/w' && claude --resume 's1'" });
    expect(ownerOf(PR, [s({ state: "ended" })], {})).toMatchObject({ route: "shelved", sessionId: "s1" });
    expect(ownerOf(PR, [], { f: [{ sessionId: "old", script: "cd '/x' && claude --resume 'old'", label: "x", prs: [PR], at: 1 }] })).toMatchObject({ route: "shelved", sessionId: "old" });
    expect(ownerOf(PR, [s({ prs: [] })], {}).route).toBe("none");
});

test("a live owner wins over an ended one that held the PR before", () => {
    expect(ownerOf(PR, [s({ id: "gone", state: "ended" }), s({ id: "now" })], {}).sessionId).toBe("now");
});
