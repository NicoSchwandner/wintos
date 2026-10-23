// The daily as items you curate: the summarizer proposes, you drop, lift to the top or rewrite.
// What you did to a project's items on earlier days decides how its items start.

// project: the project the item came from, which is what earlier choices are remembered by.
export type StandupItem = { id: string; project: string; text: string; details: string[] };
// top: when it was lifted, so the last one lifted leads.
export type Choice = { project: string; drop?: boolean; top?: number; text?: string; details?: string[] };
// examples: your rewrites, draft beside yours, for the summarizer to write like you next time.
export type Curation = { days: Record<string, Record<string, Choice>>; examples: { draft: string; mine: string }[] };
export type ShownItem = StandupItem & { dropped: boolean; top: boolean; edited: boolean };

const EXAMPLES_KEPT = 3;
// Dropped on this many days since it was last lifted: its items start dropped.
const DROPS_TO_HIDE = 2;

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

// Whether a project's items start dropped on day: dropped on DROPS_TO_HIDE earlier days since the
// last day you lifted one of its items.
export function startsDropped(c: Curation, project: string, day: string): boolean {
    if (!project) return false;
    let drops = 0;
    for (const d of Object.keys(c.days).filter((d) => d < day).sort()) {
        const mine = Object.values(c.days[d]).filter((x) => x.project === project);
        if (mine.some((x) => x.top)) drops = 0;
        else if (mine.some((x) => x.drop)) drops++;
    }
    return drops >= DROPS_TO_HIDE;
}

// The day's items as you left them: your rewrites, lifted ones first (the last lifted leading),
// dropped ones marked. An item you never touched starts as its project's history says.
export function shownItems(items: StandupItem[], c: Curation, day: string): ShownItem[] {
    const chosen = c.days[day] ?? {};
    const shown = items.map((i): ShownItem => {
        const x = chosen[i.id];
        return { ...i, text: x?.text ?? i.text, details: x?.details ?? i.details, dropped: x?.drop ?? (!x?.top && startsDropped(c, i.project, day)), top: !!x?.top, edited: x?.text !== undefined };
    });
    const at = (i: ShownItem) => chosen[i.id]?.top ?? 0;
    return [...shown.filter((i) => i.top).sort((a, b) => at(b) - at(a)), ...shown.filter((i) => !i.top)];
}

export function choose(c: Curation, day: string, item: StandupItem, change: { drop?: boolean; top?: boolean; text?: string }, now: number): Curation {
    const was = c.days[day]?.[item.id] ?? { project: item.project };
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

