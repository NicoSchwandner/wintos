import { describe, expect, test } from "vitest";
import { askCard, askPrompt, guessAsk, parseAsk } from "./asks";
import type { Ask } from "./reduce";

describe("parseAsk", () => {
    test("a kind and what it is about", () => {
        expect(parseAsk("decide: two bands or one marked band\n")).toEqual({ kind: "decide", text: "two bands or one marked band", by: "model" });
        expect(parseAsk("`Approve: the migration plan.`")).toEqual({ kind: "approve", text: "the migration plan", by: "model" });
    });

    test("a reply that only reports is done; anything else is unreadable", () => {
        expect(parseAsk("read: momentum fix is live")).toBe("done");
        expect(parseAsk("waits: the CI retry loop on test")).toEqual({ waits: "the CI retry loop on test" });
        expect(parseAsk("unblock: none needed; the merge loop runs")).toBe("done");
        expect(parseAsk("approve: nothing, it only reports")).toBe("done");
        expect(parseAsk("Waits:")).toEqual({ waits: "something it started" });
        expect(parseAsk("I think the developer should")).toBeUndefined();
    });
});

describe("guessAsk", () => {
    test("a question near the end asks it", () => {
        expect(guessAsk("Built it.\n\nShould I open the **PR** now?")).toEqual({ kind: "answer", text: "Should I open the PR now?", by: "guess" });
    });

    test("no question, or one long before the end, only reports", () => {
        expect(guessAsk("Done: the fix is live.")).toBe("done");
        expect(guessAsk(`Why? Because.\n${"x".repeat(700)}`)).toBe("done");
    });
});

test("askPrompt sends the end of a long message", () => {
    expect(askPrompt(`${"a".repeat(5000)}END`)).toContain("aEND");
    expect(askPrompt(`START${"a".repeat(5000)}`)).not.toContain("START");
});

describe("askCard", () => {
    test("context, why, options with what they lead to, the recommended one, and whether it can be undone", () =>
        expect(askCard({ context: "Routes all documents", why: "CI green", options: [{ label: "Merge now", then: "live Monday" }, { label: "Hold" }], recommend: 1, final: true })).toEqual({
            context: "Routes all documents", why: "CI green", options: [{ label: "Merge now", then: "live Monday" }, { label: "Hold" }], recommend: 1, final: true,
        }));
    test("several questions: each option names its question, 2 to 4 per question, up to 8 in all", () =>
        expect(askCard({ options: [{ label: "Keep", q: "KR1" }, { label: "Drop", q: "KR1" }, { label: "Open", q: "Denominator" }, { label: "47,300", q: "Denominator" }] })).toEqual({
            options: [{ label: "Keep", q: "KR1" }, { label: "Drop", q: "KR1" }, { label: "Open", q: "Denominator" }, { label: "47,300", q: "Denominator" }],
        }));
    test("nothing given is an empty card", () => expect(askCard({})).toEqual({}));
    test("picks: findings to toggle, some on to start with", () =>
        expect(askCard({ picks: [{ label: "Missing test for 0% VAT", on: true }, { label: "Rename feeVat" }] })).toEqual({ picks: [{ label: "Missing test for 0% VAT", on: true }, { label: "Rename feeVat", on: false }] }));
    test.each([
        [{ context: "a\nb" }, /^context/],
        [{ options: [{ label: "only one" }] }, /^options/],
        [{ options: [{ label: "a" }, { label: "b" }], recommend: 3 }, /^recommend/],
        [{ recommend: 1 }, /^recommend/],
        [{ picks: [] }, /^picks/],
        [{ options: [{ label: "a", q: "x" }, { label: "b", q: "x" }, { label: "c", q: "y" }] }, /^options/],
        [{ options: [{ label: "a", q: "x" }, { label: "b", q: "x" }, { label: "c", q: "y" }, { label: "d", q: "y" }], recommend: 1 }, /^recommend/],
        [{ picks: Array.from({ length: 9 }, (_, i) => ({ label: `p${i}` })) }, /^picks/],
    ])("a bad card is refused: %j", (b, why) => expect(askCard(b)).toMatch(why));
});

test("the model's reading carries the context and the options it found", () =>
    expect(parseAsk("decide: merge or hold\ncontext: routes all documents\noption: Merge now — live Monday\noption: Hold — two days later")).toEqual({
        kind: "decide", text: "merge or hold", by: "model", context: "routes all documents", options: [{ label: "Merge now", then: "live Monday" }, { label: "Hold", then: "two days later" }],
    }));

test("a message asking two things: each question line starts the options that answer it", () =>
    expect((parseAsk("decide: KR1 target and denominator\nquestion: KR1 target\noption: Keep — guessed target\noption: Drop — overlap stays\nquestion: Denominator\noption: Open — honest\noption: 47,300 — stand-in") as Ask).options).toEqual([
        { label: "Keep", then: "guessed target", q: "KR1 target" }, { label: "Drop", then: "overlap stays", q: "KR1 target" },
        { label: "Open", then: "honest", q: "Denominator" }, { label: "47,300", then: "stand-in", q: "Denominator" },
    ]));

test("one question line only is one question: its options carry no question", () =>
    expect((parseAsk("decide: x\nquestion: Which\noption: A\noption: B") as Ask).options).toEqual([{ label: "A" }, { label: "B" }]));
