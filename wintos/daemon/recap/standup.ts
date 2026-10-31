// The daily as items you edit as one markdown list: the summarizer proposes, you delete, reorder,
// rewrite or add lines. Each day starts fresh: what you dropped on earlier days doesn't carry over.

export type StandupItem = { id: string; project: string; text: string; details: string[] };
// order: where the item stands after your last edit. An id the proposal doesn't have is an item
// you added.
export type Choice = { drop?: boolean; order?: number; text?: string; details?: string[] };
// examples: your rewrites, draft beside yours, for the summarizer to write like you next time.
export type Curation = { days: Record<string, Record<string, Choice>>; examples: { draft: string; mine: string }[] };
export type ShownItem = StandupItem & { dropped: boolean; edited: boolean };

const EXAMPLES_KEPT = 3;

// "- [Project] Status: name" with "  - detail" lines under it. A bullet that names no project
// it was given keeps the text and belongs to no project.
export function parseItems(out: string, projects: string[]): StandupItem[] {
    const items: StandupItem[] = [];
    for (const line of out.split("\n")) {
        const detail = /^(\s{2,})[-*•]\s+(.*\S)/.exec(line);
        if (detail && items.length) {
            items[items.length - 1].details.push(" ".repeat(detail[1].length - 2) + detail[2]);
            continue;
        }
        const head = /^[-*•]\s+(?:\[([^\]]+)\]\s*)?(.*\S)/.exec(line);
        if (!head) continue;
        const project = head[1] && projects.includes(head[1].trim()) ? head[1].trim() : "";
        items.push({ id: String(items.length), project, text: head[2], details: [] });
    }
    return items;
}

// A detail is its text after the indent it has beyond the first level under the item, so a
// nested list keeps its shape through a rewrite.
export const detailsMarkdown = (details: string[]) => details.map((d) => `${/^\s*/.exec(d)![0]}- ${d.trimStart()}`).join("\n");
export const asText = (text: string, details: string[]) => [text, detailsMarkdown(details)].filter(Boolean).join("\n");

export function splitText(text: string): { text: string; details: string[] } {
    const [head = "", ...rest] = text.trim().split("\n");
    const lines = rest.filter((l) => l.trim()).map((l) => ({ indent: /^\s*/.exec(l.replace(/\t/g, "  "))![0].length, text: l.replace(/^\s*[-*•]\s+/, "").trim() }));
    const base = Math.min(...lines.map((l) => l.indent));
    return { text: head.replace(/^[-*•]\s+/, "").trim(), details: lines.map((l) => " ".repeat(l.indent - base) + l.text) };
}

// The day's items as you left them: in your order, your text, the dropped ones marked and last.
export function shownItems(items: StandupItem[], c: Curation, day: string): ShownItem[] {
    const chosen = c.days[day] ?? {};
    const added = Object.entries(chosen).filter(([id, x]) => x.text && !items.some((i) => i.id === id)).map(([id]): StandupItem => ({ id, project: "", text: "", details: [] }));
    const shown = [...items, ...added].map((i): ShownItem => {
        const x = chosen[i.id];
        return { ...i, text: x?.text ?? i.text, details: x?.details ?? i.details, dropped: !!x?.drop, edited: x?.text !== undefined };
    });
    const at = (i: ShownItem) => (i.dropped ? Infinity : (chosen[i.id]?.order ?? shown.indexOf(i)));
    return shown.sort((a, b) => at(a) - at(b));
}

// The items you read out, as the markdown you edit them in.
export const itemsMarkdown = (items: ShownItem[]) => items.filter((i) => !i.dropped).map((i) => [`- ${i.text}`, ...(i.details.length ? [detailsMarkdown(i.details).replace(/^/gm, "  ")] : [])].join("\n")).join("\n");

// The edited list, one block per top-level line with the lines under it.
function blocks(text: string): { text: string; details: string[] }[] {
    const out: string[][] = [];
    for (const l of text.split("\n")) {
        if (!l.trim()) continue;
        if (!/^\s/.test(l) || !out.length) out.push([l]);
        else out[out.length - 1].push(l);
    }
    return out.map((b) => splitText(b.join("\n"))).filter((b) => b.text);
}

const words = (t: string) => new Set(t.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
const shared = (a: string, b: string) => [...words(a)].filter((w) => words(b).has(w)).length;

// Your edit of the whole list: a line keeps the item whose text it has (a dropped one comes
// back), else the open item it shares the most words with, as a rewrite; an item left without a
// line is dropped, a line with nothing in common is one you added. A rewrite of a proposed item
// teaches the next prompt.
export function edit(c: Curation, day: string, items: StandupItem[], text: string): Curation {
    const shown = shownItems(items, c, day);
    const lines = blocks(text);
    const taken = new Set<string>();
    const ids: (string | undefined)[] = lines.map((l) => {
        const same = shown.find((i) => !taken.has(i.id) && i.text === l.text);
        return same && (taken.add(same.id), same.id);
    });
    let added = 0;
    lines.forEach((l, k) => {
        if (ids[k]) return;
        const best = shown.filter((i) => !i.dropped && !taken.has(i.id)).sort((a, b) => shared(b.text, l.text) - shared(a.text, l.text))[0];
        if (best && shared(best.text, l.text) > 0) taken.add((ids[k] = best.id));
        else ids[k] = `+${shown.length + added++}`;
    });
    const record: Record<string, Choice> = {};
    for (const i of shown) if (!ids.includes(i.id)) record[i.id] = { ...c.days[day]?.[i.id], drop: true, order: undefined };
    let examples = c.examples;
    lines.forEach((l, k) => {
        const id = ids[k]!;
        const proposed = items.find((i) => i.id === id);
        const was = shown.find((i) => i.id === id);
        const same = proposed && asText(proposed.text, proposed.details) === asText(l.text, l.details);
        record[id] = { order: k, ...(same ? {} : l) };
        if (proposed && was && asText(was.text, was.details) !== asText(l.text, l.details) && !same)
            examples = [...examples, { draft: asText(proposed.text, proposed.details), mine: asText(l.text, l.details) }].slice(-EXAMPLES_KEPT);
    });
    return { days: { ...c.days, [day]: record }, examples };
}
