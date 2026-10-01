// What a palette item can be found by beyond its title. weight ranks where a word matched (the
// title is 100); fuzzy allows scattered letters, only sensible on short text; ids holds PR numbers
// and task ids, where an exact hit beats everything; label names a long text in a hit's snippet.
export type Field = { text: string; weight: number; fuzzy?: boolean; ids?: boolean; label?: string };
export type Kind = "project" | "pr" | "session" | "action";
export type PaletteItem = { id: string; kind: Kind; title: string; subtitle?: string; hint?: string; fields?: Field[]; recency?: number; run?: (hit: Hit) => void };
export type Snippet = { label: string; before: string; match: string; after: string };
export type Hit = { item: PaletteItem; score: number; snippet?: Snippet; titleMarks?: [number, number][] };

const KIND_ORDER: Record<Kind, number> = { project: 0, pr: 1, session: 2, action: 3 };
const EXACT_ID = 10_000;
const SNIPPET_SIDE = 30;

type Match = { level: number; at: number; marks?: [number, number][] };

// Lower-cased text, matched one query word at a time: the field starting with it, a word in it
// starting with it, containing it, or (fuzzy fields only) its letters in order.
function match(text: string, word: string, fuzzy: boolean): Match | null {
    const t = text.toLowerCase();
    if (t.startsWith(word)) return { level: 1, at: 0 };
    const wordStart = new RegExp(`(^|[^a-z0-9])${escape(word)}`).exec(t);
    if (wordStart) return { level: 0.9, at: wordStart.index + wordStart[1].length };
    const at = t.indexOf(word);
    if (at >= 0 && word.length >= 3) return { level: 0.75, at };
    if (!fuzzy) return null;
    const marks: [number, number][] = [];
    let i = 0;
    for (let j = 0; j < t.length && i < word.length; j++) {
        if (t[j] !== word[i]) continue;
        const last = marks[marks.length - 1];
        if (last && last[1] === j) last[1] = j + 1;
        else marks.push([j, j + 1]);
        i++;
    }
    return i === word.length ? { level: 0.4, at: marks[0][0], marks } : null;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const idTokens = (text: string): string[] => text.toLowerCase().match(/[a-z]+-\d+|\d+/g) ?? [];

function snippet(field: Field, at: number, length: number): Snippet {
    const text = field.text.replace(/\s+/g, " ");
    const before = text.slice(Math.max(0, at - SNIPPET_SIDE), at);
    const after = text.slice(at + length, at + length + SNIPPET_SIDE);
    return {
        label: field.label!,
        before: (at > SNIPPET_SIDE ? "…" : "") + before,
        match: text.slice(at, at + length),
        after: after + (at + length + SNIPPET_SIDE < text.length ? "…" : ""),
    };
}

function scoreItem(item: PaletteItem, words: string[]): Hit | null {
    const fields: Field[] = [{ text: item.title, weight: 100, fuzzy: true }, ...(item.subtitle ? [{ text: item.subtitle, weight: 20 }] : []), ...(item.fields ?? [])];
    let score = 0;
    let snip: Snippet | undefined;
    const titleMarks: [number, number][] = [];
    for (const word of words) {
        let best: { score: number; field: Field; m?: Match } | null = null;
        for (const field of fields) {
            if (field.ids && idTokens(field.text).includes(word.replace(/^#/, ""))) {
                best = { score: EXACT_ID, field };
                break;
            }
            const m = match(field.text, word, !!field.fuzzy);
            if (m && (!best || m.level * field.weight > best.score)) best = { score: m.level * field.weight, field, m };
        }
        if (!best) return null;
        score += best.score;
        if (best.field === fields[0] && best.m) titleMarks.push(...(best.m.marks ?? [[best.m.at, best.m.at + word.length]]));
        // Normalised whitespace in the snippet: the hit's offset is found again in that text.
        if (!snip && best.field.label && best.m) {
            const flat = best.field.text.replace(/\s+/g, " ");
            const at = flat.toLowerCase().indexOf(word);
            if (at >= 0) snip = snippet(best.field, at, word.length);
        }
    }
    return { item, score, ...(snip ? { snippet: snip } : {}), ...(titleMarks.length ? { titleMarks: titleMarks.sort((a, b) => a[0] - b[0]) } : {}) };
}

export function searchPalette(items: PaletteItem[], query: string): Hit[] {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const byKind = (a: PaletteItem, b: PaletteItem) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (!words.length) return [...items].sort(byKind).map((item) => ({ item, score: 0 }));
    return items
        .map((item) => scoreItem(item, words))
        .filter((h): h is Hit => h !== null)
        .sort((a, b) => b.score - a.score || (b.item.recency ?? 0) - (a.item.recency ?? 0) || byKind(a.item, b.item));
}

// The rows the palette shows: groups ordered by their best hit, so the first row is the best
// result, each cut at `cap` with a row for the rest unless expanded.
export type Row = { type: "hit"; hit: Hit } | { type: "more"; kind: Kind; count: number };
export function groupHits(hits: Hit[], expanded: Set<Kind>, cap = 6): Row[] {
    const groups = new Map<Kind, Hit[]>();
    for (const h of hits) groups.set(h.item.kind, [...(groups.get(h.item.kind) ?? []), h]);
    const rows: Row[] = [];
    for (const [kind, group] of groups) {
        const shown = expanded.has(kind) ? group : group.slice(0, cap);
        rows.push(...shown.map((hit): Row => ({ type: "hit", hit })));
        if (shown.length < group.length) rows.push({ type: "more", kind, count: group.length - shown.length });
    }
    return rows;
}
