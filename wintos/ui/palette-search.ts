export type PaletteItem = { id: string; kind: "project" | "session" | "action"; title: string; subtitle?: string; hint?: string; run?: () => void };

const KIND_ORDER = { project: 0, session: 1, action: 2 } as const;

// Lower is better: title prefix, then a word in the title starting with it, then the title
// containing it, then its letters in order, then the subtitle. Unmatched: null.
function score(item: PaletteItem, q: string): number | null {
    const t = item.title.toLowerCase();
    if (t.startsWith(q)) return 0;
    if (t.split(/[\s\-_/·]+/).some((w) => w.startsWith(q))) return 1;
    if (t.includes(q)) return 2;
    if (subsequence(t, q)) return 3;
    if (item.subtitle?.toLowerCase().includes(q)) return 4;
    return null;
}

const subsequence = (s: string, q: string) => {
    let i = 0;
    for (const ch of s) if (ch === q[i]) i++;
    return i === q.length;
};

export function searchPalette(items: PaletteItem[], query: string): PaletteItem[] {
    const q = query.trim().toLowerCase();
    const byKind = (a: PaletteItem, b: PaletteItem) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (!q) return [...items].sort(byKind);
    return items
        .map((item) => ({ item, s: score(item, q) }))
        .filter((x): x is { item: PaletteItem; s: number } => x.s !== null)
        .sort((a, b) => a.s - b.s || byKind(a.item, b.item))
        .map((x) => x.item);
}
