// The daily as items you curate: the summarizer proposes, you drop, lift to the top or rewrite.
// Each day starts fresh: what you dropped on earlier days doesn't carry over.

export type StandupItem = { id: string; project: string; text: string; details: string[] };
// top: when it was lifted, so the last one lifted leads.
export type Choice = { drop?: boolean; top?: number; text?: string; details?: string[] };
// examples: your rewrites, draft beside yours, for the summarizer to write like you next time.
export type Curation = { days: Record<string, Record<string, Choice>>; examples: { draft: string; mine: string }[] };
export type ShownItem = StandupItem & { dropped: boolean; top: boolean; edited: boolean };

const EXAMPLES_KEPT = 3;

// "- [Project] Status: name" with "  - detail" lines under it. A bullet that names no project
// it was given keeps the text and belongs to no project.
export function parseItems(out: string, projects: string[]): StandupItem[] {
    const items: StandupItem[] = [];
    for (const line of out.split("\n")) {
        const detail = /^\s{2,}[-*•]\s+(.*\S)/.exec(line);
        if (detail && items.length) {
            items[items.length - 1].details.push(detail[1]);
            continue;
        }
        const head = /^[-*•]\s+(?:\[([^\]]+)\]\s*)?(.*\S)/.exec(line);
        if (!head) continue;
        const project = head[1] && projects.includes(head[1].trim()) ? head[1].trim() : "";
        items.push({ id: String(items.length), project, text: head[2], details: [] });
    }
    return items;
}

const asText = (text: string, details: string[]) => [text, ...details.map((d) => `- ${d}`)].join("\n");

export function splitText(text: string): { text: string; details: string[] } {
    const [head = "", ...rest] = text.trim().split("\n");
    return { text: head.replace(/^[-*•]\s+/, "").trim(), details: rest.map((l) => l.replace(/^\s*[-*•]\s+/, "").trim()).filter(Boolean) };
}

// The day's items as you left them: your rewrites, lifted ones first (the last lifted leading),
// dropped ones marked.
export function shownItems(items: StandupItem[], c: Curation, day: string): ShownItem[] {
    const chosen = c.days[day] ?? {};
    const shown = items.map((i): ShownItem => {
        const x = chosen[i.id];
        return { ...i, text: x?.text ?? i.text, details: x?.details ?? i.details, dropped: !!x?.drop, top: !!x?.top, edited: x?.text !== undefined };
    });
    const at = (i: ShownItem) => chosen[i.id]?.top ?? 0;
    return [...shown.filter((i) => i.top).sort((a, b) => at(b) - at(a)), ...shown.filter((i) => !i.top)];
}

export function choose(c: Curation, day: string, item: StandupItem, change: { drop?: boolean; top?: boolean; text?: string }, now: number): Curation {
    const was = c.days[day]?.[item.id] ?? {};
    const next: Choice = { ...was };
    if (change.drop !== undefined) next.drop = change.drop;
    if (change.top !== undefined) next.top = change.top ? now : undefined;
    // Lifting an item takes it out of the dropped ones.
    if (change.top) next.drop = false;
    let examples = c.examples;
    if (change.text !== undefined) {
        const mine = splitText(change.text);
        if (mine.text) {
            Object.assign(next, mine);
            examples = [...examples, { draft: asText(item.text, item.details), mine: asText(mine.text, mine.details) }].slice(-EXAMPLES_KEPT);
        }
    }
    return { days: { ...c.days, [day]: { ...c.days[day], [item.id]: next } }, examples };
}

