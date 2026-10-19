import { describe, expect, test } from "vitest";
import { askPrompt, guessAsk, parseAsk } from "./asks";

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
