import { describe, expect, test } from "vitest";
import { afterCheck, expiresAt, isLogic, logicLinesOf, reached, rekeyed, rollup, wakeId, wakePrompt, wakesOf, waitingOn, wakesWhen, type PrNow, type Wake } from "./wakes";

const pr = (o: Partial<PrNow> = {}): PrNow => ({ state: "OPEN", checks: "pending", released: false, ...o });
const URL = "https://github.com/o/r/pull/7";
const wake = (o: Partial<Wake> = {}): Wake => ({ sessionId: "s", pr: URL, until: "green", prompt: "approve it", at: 0, expires: 100, ...o });

describe("reached", () => {
    test("green when its CI is; merged once merged; released once on main", () => {
        expect([reached("green", pr({ checks: "green" }), 0), reached("green", pr({ checks: "red" }), 0)]).toEqual([true, false]);
        expect([reached("merged", pr({ state: "MERGED" }), 0), reached("merged", pr(), 0)]).toEqual([true, false]);
        expect([reached("released", pr({ state: "MERGED", released: true }), 0), reached("released", pr({ state: "MERGED" }), 0)]).toEqual([true, false]);
    });
});

describe("review events", () => {
    test("a re-review when you are requested again; feedback only when it came after the wake was set", () => {
        expect([reached("rereview", pr({ requestedAgain: true }), 0), reached("rereview", pr(), 0)]).toEqual([true, false]);
        expect([reached("comments", pr({ feedbackAt: 20 }), 10), reached("comments", pr({ feedbackAt: 5 }), 10)]).toEqual([true, false]);
    });
    test("a merged PR wants no more review: the wake is dropped", () =>
        expect(afterCheck({ a: wake({ until: "rereview" }) }, 50, { [URL]: pr({ state: "MERGED", requestedAgain: true }) }).dropped).toHaveLength(1));
    test("a due re-review carries how much logic changed; past the limit the session asks instead", () => {
        const small = afterCheck({ a: wake({ until: "rereview", prompt: "re-review the fixes" }) }, 50, { [URL]: pr({ requestedAgain: true, logicLines: 12 }) }).wakes.a;
        expect([small.lines, wakePrompt(small)]).toEqual([12, "[WintOS wake: o/r#7 asks for your review again; 12 lines of logic changed since your review] re-review the fixes"]);
        const big = wakePrompt({ ...small, lines: 240 });
        expect(big).toContain("Don't re-review it.");
        expect(big).toContain('wintos ask approve "re-review o/r#7: 240 lines of logic changed"');
        const unknown = afterCheck({ a: wake({ until: "rereview" }) }, 50, { [URL]: pr({ requestedAgain: true }) }).wakes.a;
        expect(wakePrompt(unknown)).toContain("an unknown amount of logic changed");
    });
    test("feedback comes with the triage: small fixes yes, a different approach is the developer's", () =>
        expect(wakePrompt(wake({ until: "comments", prompt: "work the comments." }))).toMatch(/^\[WintOS wake: o\/r#7 has new review feedback\] work the comments\. Triage each comment first: .*wintos ask decide/));
});

test.each([
    ["src/Service/Booking.cs", true],
    ["web/app/page.tsx", true],
    ["Wint.Core.Tests/BookingTests.cs", false],
    ["src/Booking.Tests/X.cs", false],
    ["ui/view.test.ts", false],
    ["Data/Migrations/20261021_Add.cs", false],
    ["Data/AppModelSnapshot.cs", false],
    ["Api/Client.g.cs", false],
    ["package-lock.json", false],
    ["README.md", false],
    [".github/workflows/ci.yml", false],
    ["Directory.Packages.props", false],
    ["src/Api/Api.csproj", false],
    ["Snapshots/Report.verified.txt", false],
])("%s is logic: %s", (path, logic) => expect(isLogic(path)).toBe(logic));

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
    expect([wakesWhen(wake()), wakesWhen(wake({ until: "merged" })), wakesWhen(wake({ until: "rereview" }))]).toEqual(["wakes when o/r#7 goes green", "wakes when o/r#7 is merged", "wakes when o/r#7 asks for a re-review"]);
    expect(wakesWhen(wake(), "R #7")).toBe("wakes when R #7 goes green");
    expect(wakePrompt(wake({ until: "released" }))).toBe("[WintOS wake: o/r#7 is released] approve it");
});

describe("logicLinesOf", () => {
    test("only the PR's own files, and only logic: a base merge and tests don't count", () =>
        expect(logicLinesOf([{ f: "src/A.cs", n: 10 }, { f: "src/ATests.cs", n: 30 }, { f: "src/FromBase.cs", n: 99 }, { f: "README.md", n: 5 }], ["src/A.cs", "src/ATests.cs", "README.md"])).toBe(10));
    test("a PR of Markdown only (a rules repo): its Markdown is its logic, tooling folders still not", () =>
        expect(logicLinesOf([{ f: "content/rules/x.md", n: 40 }, { f: ".claude/notes.md", n: 7 }], ["content/rules/x.md", ".claude/notes.md"])).toBe(40));
});

describe("several wakes per session", () => {
    test("wakesOf: one session's, the due first, then the latest set; rekeyed: the old one-per-session file", () => {
        const a = wake({ until: "comments", at: 1 }), b = wake({ until: "merged", at: 2 }), c = wake({ until: "green", at: 3, due: 9 });
        const wakes = rekeyed({ s: a, t: b, u: c, x: wake({ sessionId: "other" }) });
        expect(Object.keys(wakes)).toContain(wakeId(a));
        expect(wakesOf(wakes, a.sessionId).map((w) => w.until)).toEqual(["green", "merged", "comments"]);
    });
});
