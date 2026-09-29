import { describe, expect, test } from "vitest";
import { prLinkPaste, takePendingPrompt } from "./newproject";

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
