import { expect, test } from "vitest";
import { claimReopen } from "./focus";

test("a project is reopened once: the same one again within seconds (a repeated ⌃⇥ from the new tab) is refused", () => {
    const store = new Map<string, string>();
    const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect([claimReopen(ls, "p1", 1000), claimReopen(ls, "p1", 1200), claimReopen(ls, "p2", 1300), claimReopen(ls, "p1", 9000)]).toEqual([true, false, true, true]);
});
