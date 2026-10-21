import { describe, expect, test } from "vitest";
import { afterCheck, expiresAt, reached, rollup, wakePrompt, waitingOn, wakesWhen, type PrNow, type Wake } from "./wakes";

const pr = (o: Partial<PrNow> = {}): PrNow => ({ state: "OPEN", checks: "pending", released: false, ...o });
const URL = "https://github.com/o/r/pull/7";
const wake = (o: Partial<Wake> = {}): Wake => ({ sessionId: "s", pr: URL, until: "green", prompt: "approve it", at: 0, expires: 100, ...o });

describe("reached", () => {
    test("green when its CI is; merged once merged; released once on main", () => {
        expect([reached("green", pr({ checks: "green" })), reached("green", pr({ checks: "red" }))]).toEqual([true, false]);
        expect([reached("merged", pr({ state: "MERGED" })), reached("merged", pr())]).toEqual([true, false]);
        expect([reached("released", pr({ state: "MERGED", released: true })), reached("released", pr({ state: "MERGED" }))]).toEqual([true, false]);
    });
});

describe("rollup", () => {
    test("all passed (or skipped) is green, any failure red, anything running pending, none none", () => {
        expect(rollup([{ status: "COMPLETED", conclusion: "SUCCESS" }, { state: "SUCCESS" }, { status: "COMPLETED", conclusion: "SKIPPED" }])).toBe("green");
        expect(rollup([{ status: "COMPLETED", conclusion: "SUCCESS" }, { status: "COMPLETED", conclusion: "FAILURE" }])).toBe("red");
        expect(rollup([{ status: "COMPLETED", conclusion: "SUCCESS" }, { status: "IN_PROGRESS" }])).toBe("pending");
        expect(rollup([{ state: "PENDING" }])).toBe("pending");
        expect(rollup([])).toBe("none");
    });
});

describe("afterCheck", () => {
    test("a wake whose event came is due from then on; others wait", () => {
        const { wakes, dropped } = afterCheck({ a: wake(), b: wake({ until: "merged" }) }, 50, { [URL]: pr({ checks: "green" }) });
        expect([wakes.a.due, wakes.b.due, dropped]).toEqual([50, undefined, []]);
        expect(afterCheck(wakes, 60, { [URL]: pr({ checks: "red" }) }).wakes.a.due).toBe(50);
    });
    test("a closed PR, a merge without green CI, or the expiry drops it; an unknown PR state keeps it", () => {
        expect(afterCheck({ a: wake({ until: "merged" }) }, 50, { [URL]: pr({ state: "CLOSED" }) }).dropped).toHaveLength(1);
        expect(afterCheck({ a: wake() }, 50, { [URL]: pr({ state: "MERGED", checks: "red" }) }).dropped).toHaveLength(1);
        expect(afterCheck({ a: wake() }, 101, {}).dropped).toHaveLength(1);
        expect(afterCheck({ a: wake() }, 50, {}).wakes.a).toBeDefined();
    });
});

test("expires five working days later, a weekend not counted", () =>
    expect(new Date(expiresAt(Date.parse("2026-10-23T10:00:00"))).toDateString()).toBe(new Date("2026-10-30T10:00:00").toDateString()));

test("what the pane shows while it waits, and what the session is told", () => {
    expect(waitingOn(wake({ until: "released" }))).toBe("o/r#7 to be released");
    expect(waitingOn(wake())).toBe("o/r#7 to go green");
    expect([wakesWhen(wake()), wakesWhen(wake({ until: "merged" }))]).toEqual(["wakes when o/r#7 goes green", "wakes when o/r#7 is merged"]);
    expect(wakesWhen(wake(), "R #7")).toBe("wakes when R #7 goes green");
    expect(wakePrompt(wake({ until: "released" }))).toBe("[WintOS wake: o/r#7 is released] approve it");
});
