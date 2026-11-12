import { describe, expect, test } from "vitest";
import { clearDraft, hasDraft, restoreDraft, keepDraft } from "./drafts";

const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } as Storage;
};

describe("drafts", () => {
    test("text typed and left comes back, over what the editor would start from", () => {
        const s = store();
        keepDraft("mine:t1", "half a thought", "the file", s);
        expect(restoreDraft("mine:t1", "the file", s)).toEqual({ text: "half a thought", stale: false });
        expect(hasDraft("mine:t1", s)).toBe(true);
    });
    test("a draft written against an older version says so", () => {
        const s = store();
        keepDraft("mine:t1", "mine", "old file", s);
        expect(restoreDraft("mine:t1", "new file", s)).toEqual({ text: "mine", stale: true });
    });
    test("typing back to where it started keeps nothing; saving or discarding clears it", () => {
        const s = store();
        keepDraft("k", "the file", "the file", s);
        expect(hasDraft("k", s)).toBe(false);
        keepDraft("k", "edit", "the file", s);
        clearDraft("k", s);
        expect(restoreDraft("k", "the file", s)).toBeUndefined();
    });
    test("drafts are per key, and a broken store loses only the draft", () => {
        const s = store();
        keepDraft("a", "x", "", s);
        expect(restoreDraft("b", "", s)).toBeUndefined();
        const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => {} } as unknown as Storage;
        expect(() => keepDraft("a", "x", "", broken)).not.toThrow();
        expect(restoreDraft("a", "", broken)).toBeUndefined();
    });
});
