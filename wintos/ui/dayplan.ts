import type { Meeting } from "./meetings";

// The Today page's day, the workday (WINTOS_WORKDAY, else 08:00-17:00): meetings, the lunch break
// (WINTOS_LUNCH), and the free time left between them, which is what a plan has to fit in.
export const DEFAULT_WORKDAY: [number, number] = [8 * 60, 17 * 60];
const MIN_FREE_MS = 15 * 60_000;

// "HH:MM-HH:MM" as minutes since midnight: the lunch break, the workday.
export function parseSpan(v: string | undefined): [number, number] | undefined {
    const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(v?.trim() ?? "");
    if (!m) return undefined;
    const [a, b] = [Number(m[1]) * 60 + Number(m[2]), Number(m[3]) * 60 + Number(m[4])];
    return a < b ? [a, b] : undefined;
}

// col/cols: a meeting's column among those it overlaps with, so they sit side by side.
export type Block = { kind: "meeting" | "lunch" | "free"; start: number; end: number; title?: string; col?: number; cols?: number };

// Meetings that overlap, directly or through another, share columns: each takes the first column
// free at its start, and the group is as wide as it needed.
function sideBySide(meetings: Block[]): Block[] {
    const out: Block[] = [];
    let group: Block[] = [];
    let ends: number[] = [];
    let groupEnd = -Infinity;
    const close = () => out.push(...group.map((b) => ({ ...b, cols: ends.length })));
    for (const m of [...meetings].sort((a, b) => a.start - b.start)) {
        if (m.start >= groupEnd) {
            close();
            group = [];
            ends = [];
            groupEnd = -Infinity;
        }
        let col = ends.findIndex((e) => e <= m.start);
        if (col < 0) col = ends.push(0) - 1;
        ends[col] = m.end;
        group.push({ ...m, col });
        groupEnd = Math.max(groupEnd, m.end);
    }
    close();
    return out;
}

// Time in [from, to) not covered by any of the spans.
function gaps(spans: { start: number; end: number }[], from: number, to: number): { start: number; end: number }[] {
    const out: { start: number; end: number }[] = [];
    let at = from;
    for (const s of [...spans].sort((a, b) => a.start - b.start)) {
        if (s.start > at) out.push({ start: at, end: Math.min(s.start, to) });
        at = Math.max(at, s.end);
        if (at >= to) break;
    }
    if (at < to) out.push({ start: at, end: to });
    return out.filter((g) => g.end > g.start);
}

export function dayTimeline(meetings: Meeting[], lunch: [number, number] | undefined, day: Date, workday = DEFAULT_WORKDAY): { blocks: Block[]; freeMs: number; from: number; to: number } {
    const at = (min: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, min).getTime();
    const from = at(workday[0]);
    const to = at(workday[1]);
    const today = sideBySide(meetings.filter((m) => m.end > from && m.start < to).map((m): Block => ({ kind: "meeting", start: Math.max(m.start, from), end: Math.min(m.end, to), title: m.title })));
    // Lunch is what meetings leave of it; free time is what meetings and lunch leave of the day.
    const lunchBlocks = lunch ? gaps(today, at(lunch[0]), at(lunch[1])).map((g): Block => ({ kind: "lunch", ...g })) : [];
    const free = gaps([...today, ...lunchBlocks], from, to).filter((g) => g.end - g.start >= MIN_FREE_MS).map((g): Block => ({ kind: "free", ...g }));
    const blocks = [...today, ...lunchBlocks, ...free].sort((a, b) => a.start - b.start);
    return { blocks, freeMs: free.reduce((n, b) => n + b.end - b.start, 0), from, to };
}

// The checklist in a focus section, each item with its line (what a tick flips).
type FocusItem = ReturnType<typeof focusList>[number];
// What is still to do: the open items, and a ticked one while something under it is open, so the
// open child keeps its parent for context.
export function openFocus(items: FocusItem[]): FocusItem[] {
    return items.filter((item, i) => {
        if (!item.done) return true;
        for (const after of items.slice(i + 1)) {
            if (after.depth <= item.depth) return false;
            if (!after.done) return true;
        }
        return false;
    });
}

// depth: how far the item is indented under another, two spaces or a tab a step.
export function focusList(text: string): { line: number; text: string; done: boolean; depth: number }[] {
    return text.split("\n").flatMap((l, line) => {
        const m = /^(\s*)[-*] \[([ xX~])\]\s+(.*)$/.exec(l);
        return m ? [{ line, text: m[3], done: m[2] === "x" || m[2] === "X", depth: Math.floor(m[1].replace(/\t/g, "  ").length / 2) }] : [];
    });
}

// The focus section as shown: its boxes and the plain bullets among them, the notes.
export function focusLines(text: string): (FocusItem & { note?: true })[] {
    return text.split("\n").flatMap((l, line) => {
        const box = /^(\s*)[-*] \[([ xX~])\]\s+(.*)$/.exec(l);
        const note = !box && /^(\s*)[-*]\s+(.*\S)/.exec(l);
        const depth = (indent: string) => Math.floor(indent.replace(/\t/g, "  ").length / 2);
        if (box) return [{ line, text: box[3], done: box[2] === "x" || box[2] === "X", depth: depth(box[1]) }];
        return note ? [{ line, text: note[2], done: false, depth: depth(note[1]), note: true as const }] : [];
    });
}

// openFocus with the notes: one shows while the item it sits under does, one under no item always.
export function openWithNotes(lines: ReturnType<typeof focusLines>): ReturnType<typeof focusLines> {
    const kept = new Set(openFocus(lines.filter((l) => !l.note)).map((i) => i.line));
    return lines.filter((l, k) => {
        if (!l.note) return kept.has(l.line);
        const owner = lines.slice(0, k).reverse().find((o) => !o.note && o.depth < l.depth);
        return !owner || kept.has(owner.line);
    });
}
