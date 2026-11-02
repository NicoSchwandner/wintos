// Text typed into an editor and left unsaved (another page, another project, a restart), kept per
// editor until it is saved or discarded. localStorage: every renderer of the window shares it.
const PREFIX = "wintos.draft.";

type Kept = { text: string; base: string };

export function keepDraft(key: string, text: string, base: string, store: Storage = localStorage): void {
    try {
        if (text === base) store.removeItem(PREFIX + key);
        else store.setItem(PREFIX + key, JSON.stringify({ text, base } satisfies Kept));
    } catch {}
}

// stale: what the editor starts from changed since the draft was written (the file was edited elsewhere).
export function restoreDraft(key: string, base: string, store: Storage = localStorage): { text: string; stale: boolean } | undefined {
    try {
        const k = JSON.parse(store.getItem(PREFIX + key) ?? "null") as Kept | null;
        return k && typeof k.text === "string" ? { text: k.text, stale: k.base !== base } : undefined;
    } catch {
        return undefined;
    }
}

export const hasDraft = (key: string, store: Storage = localStorage) => {
    try {
        return store.getItem(PREFIX + key) != null;
    } catch {
        return false;
    }
};

export function clearDraft(key: string, store: Storage = localStorage): void {
    try {
        store.removeItem(PREFIX + key);
    } catch {}
}
