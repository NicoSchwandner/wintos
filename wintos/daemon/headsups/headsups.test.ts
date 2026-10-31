import { describe, expect, test } from "vitest";
import { capture, dismiss, readStore, watchHealth, type HeadsUp, type Health } from "./headsups";

// The plugin's store as Claude Code 2.1.311 writes it: an offer sits on its session's entry until
// it is answered or a few prompts pass.
const offer = (id: string, line: string, shownAt = 1) => ({ id, askedTurn: "t1", offeredTurn: "t1", tag: "Heads up", view: { kind: "offer", line, explanation: `why: ${line}`, shownAt } });
const store = (sessions: unknown[], seen: string[] = []) => ({ known: [], looksToSkip: 0, seen, sessions, typedPastInARow: 0 });

describe("readStore", () => {
    test("an offer on a session's entry is that session's heads-up; entries without one are skipped", () => {
        const r = readStore(store([offer("s1", "Merging won't deploy it.", 5), { id: "s2", askedTurn: "t" }], ["Merging won't deploy it."]));
        expect(r).toEqual({ offers: [{ sessionId: "s1", text: "Merging won't deploy it.", explanation: "why: Merging won't deploy it.", at: 5 }], seen: ["Merging won't deploy it."] });
    });
    test("a view that is not an offer (asked, explained) is no heads-up", () =>
        expect(readStore(store([{ id: "s1", view: { kind: "asked" } }]))).toEqual({ offers: [], seen: [] }));
    test("a store whose shape moved is a problem, not an empty list", () => {
        expect(readStore({ seen: [] })).toEqual({ problem: "no sessions list" });
        expect(readStore({ sessions: [], seen: "x" })).toEqual({ problem: "no seen list" });
        expect(readStore(store([{ id: 3 }]))).toEqual({ problem: "a session without an id" });
        expect(readStore(store([{ id: "s1", view: { kind: "offer", text: "renamed" } }]))).toEqual({ problem: "an offer without its line or time" });
        expect(readStore("nope")).toEqual({ problem: "not an object" });
    });
});

describe("capture", () => {
    const projectOf = (id: string) => (id === "s1" ? "proj" : undefined);
    test("an offer from a WintOS session becomes a heads-up of its project, once", () => {
        const one = capture([], [{ sessionId: "s1", text: "a", at: 5 }], projectOf);
        expect(one).toEqual([{ id: "s1:5", sessionId: "s1", project: "proj", text: "a", at: 5 }]);
        expect(capture(one, [{ sessionId: "s1", text: "a", at: 5 }], projectOf)).toBe(one);
    });
    test("a session outside WintOS has no project: its offer is left out", () =>
        expect(capture([], [{ sessionId: "other", text: "a", at: 5 }], projectOf)).toEqual([]));
    test("a newer offer from the same session is added, the older one kept", () =>
        expect(capture(capture([], [{ sessionId: "s1", text: "a", at: 5 }], projectOf), [{ sessionId: "s1", text: "b", at: 9 }], projectOf).map((h) => h.text)).toEqual(["a", "b"]));
});

describe("dismiss", () => {
    const list: HeadsUp[] = [{ id: "s1:5", sessionId: "s1", project: "p", text: "a", at: 5 }];
    test("drops the one closed; an unknown id changes nothing", () => {
        expect(dismiss(list, "s1:5")).toEqual([]);
        expect(dismiss(list, "nope")).toBe(list);
    });
});

// The canary: every heads-up the plugin shows is appended to seen in the same write as its offer.
// A line that turns up in seen with no offer beside it is one we failed to read.
describe("watchHealth", () => {
    const fresh: Health = { missed: 0 };
    const read = (seen: string[], offers: string[] = []) => ({ seen, offers: offers.map((text, i) => ({ sessionId: `s${i}`, text, at: i })) });
    test("the first read only sets the baseline", () => expect(watchHealth(fresh, read(["old"]))).toEqual({ missed: 0, seen: ["old"] }));
    test("a new line with its offer is healthy", () => expect(watchHealth({ missed: 1, seen: ["old"] }, read(["old", "new"], ["new"]))).toEqual({ missed: 0, seen: ["old", "new"] }));
    test("one miss is counted, not yet a problem (it may have been answered before we read it)", () => {
        const h = watchHealth({ missed: 0, seen: ["old"] }, read(["old", "new"]));
        expect([h.missed, h.problem]).toEqual([1, undefined]);
    });
    test("two misses in a row mean the offers moved", () => {
        const h = watchHealth({ missed: 1, seen: ["old"] }, read(["old", "new"]));
        expect(h.problem).toMatch(/2 heads-ups appeared without an offer/);
    });
    test("lines that only scrolled out of the capped list are no misses", () =>
        expect(watchHealth({ missed: 0, seen: ["a", "b"] }, read(["b"])).missed).toBe(0));
    test("a store that can't be read is the problem", () =>
        expect(watchHealth({ missed: 0, seen: ["a"] }, { problem: "no seen list" })).toEqual({ missed: 0, seen: ["a"], problem: "the store's shape changed: no seen list" }));
});
