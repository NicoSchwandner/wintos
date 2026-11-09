import { expect, test } from "vitest";
import { claimReopen, sessionInPane } from "./focus";

test("a project is reopened once: the same one again within seconds (a repeated ⌃⇥ from the new tab) is refused", () => {
    const store = new Map<string, string>();
    const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect([claimReopen(ls, "p1", 1000), claimReopen(ls, "p1", 1200), claimReopen(ls, "p2", 1300), claimReopen(ls, "p1", 9000)]).toEqual([true, false, true, true]);
});

test("sessionInPane: only the focused pane's own session, never another one in its view", () => {
    const a = { id: "a", tabId: "t", blockId: "b1", state: "idle", lastAt: 1 } as Parameters<typeof sessionInPane>[0][number];
    expect(sessionInPane([a], "b2")).toBeUndefined();
    expect(sessionInPane([a], undefined)).toBeUndefined();
    expect(sessionInPane([a], "b1")).toBe(a);
});

test("sessionInPane: the pane's running session, not one it ran before that ended, the newest if several", () => {
    const at = (id: string, state: string, lastAt: number) => ({ id, tabId: "t", blockId: "b1", state, lastAt }) as Parameters<typeof sessionInPane>[0][number];
    const old = at("old", "ended", 5), live = at("live", "waiting", 3), stale = at("stale", "idle", 1);
    expect(sessionInPane([old, stale, live], "b1")).toBe(live);
    expect(sessionInPane([old], "b1")).toBeUndefined();
});
