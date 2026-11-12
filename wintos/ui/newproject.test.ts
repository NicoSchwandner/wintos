import { describe, expect, test } from "vitest";
import { prLinkPaste, takePendingPrompt, takePendingStep } from "./newproject";

describe("prLinkPaste", () => {
    test("pastes the PR link as the prompt's first line without sending it", () => {
        // Bracketed paste: Claude takes the newline as text, so the prompt waits for the rest.
        expect(prLinkPaste("https://github.com/acme/api/pull/7")).toBe("\x1b[200~https://github.com/acme/api/pull/7\n\x1b[201~");
    });
});

describe("takePendingPrompt", () => {
    test("a fresh hand-off is taken once", () => {
        const store = new Map([["wintos:new-project", JSON.stringify({ prompt: "p", at: 1000 })]]);
        const ls = { getItem: (k: string) => store.get(k) ?? null, removeItem: (k: string) => void store.delete(k) };
        expect(takePendingPrompt(ls, 5000)).toBe("p");
        expect(takePendingPrompt(ls, 5000)).toBeUndefined();
    });

    test("a stale one (the new project never opened) is dropped", () => {
        const store = new Map([["wintos:new-project", JSON.stringify({ prompt: "p", at: 1000 })]]);
        const ls = { getItem: (k: string) => store.get(k) ?? null, removeItem: (k: string) => void store.delete(k) };
        expect(takePendingPrompt(ls, 1000 + 60_000)).toBeUndefined();
    });
});

describe("takePendingStep (⌘N's sheet)", () => {
    const of = (v: object) => {
        const store = new Map([["wintos:new-step", JSON.stringify(v)]]);
        return { getItem: (k: string) => store.get(k) ?? null, removeItem: (k: string) => void store.delete(k) };
    };
    test("the epic and the step, taken once", () => {
        const ls = of({ epic: "route", step: "Drafts mapping", at: 1000 });
        expect(takePendingStep(ls, 5000)).toEqual({ epic: "route", step: "Drafts mapping" });
        expect(takePendingStep(ls, 5000)).toBeUndefined();
    });
    test("a new epic agent says whose", () => expect(takePendingStep(of({ epic: "route", step: "Route agent", agentOf: "route", at: 1000 }), 5000)).toEqual({ epic: "route", step: "Route agent", agentOf: "route" }));
    test("a planned step names its roadmap step", () => expect(takePendingStep(of({ epic: "route", step: "Cutover", unit: "Cutover", at: 1000 }), 5000)).toEqual({ epic: "route", step: "Cutover", unit: "Cutover" }));
    test("no epic chosen, no step typed: nothing to set", () => expect(takePendingStep(of({ at: 1000 }), 5000)).toEqual({}));
    test("a stale one is dropped", () => expect(takePendingStep(of({ epic: "route", at: 1000 }), 1000 + 60_000)).toBeUndefined());
});
