import { describe, expect, test } from "vitest";
import { askCard, askPrompt, guessAsk, parseAsk } from "./asks";

describe("parseAsk", () => {
    test("a kind and what it is about", () => {
        expect(parseAsk("decide: two bands or one marked band\n")).toEqual({ kind: "decide", text: "two bands or one marked band", by: "model" });
        expect(parseAsk("`Approve: the migration plan.`")).toEqual({ kind: "approve", text: "the migration plan", by: "model" });
    });

    test("a reply that only reports is done; anything else is unreadable", () => {
        expect(parseAsk("read: momentum fix is live")).toBe("done");
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
    test("nothing given is an empty card", () => expect(askCard({})).toEqual({}));
    test.each([
        [{ context: "a\nb" }, /^context/],
        [{ options: [{ label: "only one" }] }, /^options/],
        [{ options: [{ label: "a" }, { label: "b" }], recommend: 3 }, /^recommend/],
        [{ recommend: 1 }, /^recommend/],
    ])("a bad card is refused: %j", (b, why) => expect(askCard(b)).toMatch(why));
});

test("the model's reading carries the context and the options it found", () =>
    expect(parseAsk("decide: merge or hold\ncontext: routes all documents\noption: Merge now — live Monday\noption: Hold — two days later")).toEqual({
        kind: "decide", text: "merge or hold", by: "model", context: "routes all documents", options: [{ label: "Merge now", then: "live Monday" }, { label: "Hold", then: "two days later" }],
    }));
