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

export type Block = { kind: "meeting" | "lunch" | "free"; start: number; end: number; title?: string };

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
    const today = meetings.filter((m) => m.end > from && m.start < to).map((m): Block => ({ kind: "meeting", start: Math.max(m.start, from), end: Math.min(m.end, to), title: m.title }));
    // Lunch is what meetings leave of it; free time is what meetings and lunch leave of the day.
    const lunchBlocks = lunch ? gaps(today, at(lunch[0]), at(lunch[1])).map((g): Block => ({ kind: "lunch", ...g })) : [];
    const free = gaps([...today, ...lunchBlocks], from, to).filter((g) => g.end - g.start >= MIN_FREE_MS).map((g): Block => ({ kind: "free", ...g }));
    const blocks = [...today, ...lunchBlocks, ...free].sort((a, b) => a.start - b.start);
    return { blocks, freeMs: free.reduce((n, b) => n + b.end - b.start, 0), from, to };
}

// The checklist in a focus section, each item with its line (what a tick flips).
export function focusList(text: string): { line: number; text: string; done: boolean }[] {
    return text.split("\n").flatMap((l, line) => {
        const m = /^\s*[-*] \[([ xX~])\]\s+(.*)$/.exec(l);
        return m ? [{ line, text: m[2], done: m[1] === "x" || m[1] === "X" }] : [];
    });
}
