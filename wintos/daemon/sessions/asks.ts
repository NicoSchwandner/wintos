import { ASK_KINDS, type Ask, type AskCard, type AskKind, type AskOption } from "./reduce";

const MESSAGE_TAIL = 3000;
const ASK_TEXT_MAX = 90;
// A question this close to the end of a reply is what the reply leaves the developer with.
const QUESTION_TAIL = 600;

// For a turn that ended without saying what it expects (no `wintos ask`, wait or done).
export function askPrompt(message: string): string {
    return [
        "A coding agent ended its turn with the message below. Say what it now expects of the developer, as one line",
        "`<kind>: <what, in at most 10 words>`, where kind is one of:",
        "- answer: it asked them a question",
        "- decide: it laid out options and they pick one",
        "- approve: a plan, a change or a step waits for their go",
        "- unblock: it needs them to do something it can't (a login, an unlock, a manual step)",
        "- read: it only reports (done, a status, an analysis, a PR to look at); nothing waits on them",
        'E.g. "decide: two bands or one marked band", "read: momentum fix is live".',
        "Unless it is read, add a line `context: <what this is about, at most 12 words>`, and when the message offers",
        "choices, one line each (2 to 4) `option: <the choice, a few words> — <what it leads to, a few words>`.",
        "When it asks more than one thing, put `question: <which, a few words>` before the options of each, up to 8 options in all.",
        "Reply with these lines only.",
        "",
        "Message:",
        message.slice(-MESSAGE_TAIL),
    ].join("\n");
}

const clip = (t: string) => (t.length > ASK_TEXT_MAX ? `${t.slice(0, ASK_TEXT_MAX - 1).trimEnd()}…` : t);

export function parseAsk(out: string): Ask | "done" | undefined {
    const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
    const m = /^\W*(answer|decide|approve|unblock|read)\b\W*(.*)$/i.exec(lines[0] ?? "");
    if (!m) return undefined;
    const kind = m[1].toLowerCase();
    if (kind === "read") return "done";
    const text = m[2].replace(/^["'“`]+|["'”.`]+$/g, "").trim();
    const context = lines.map((l) => /^context:\s*(.+)$/i.exec(l)?.[1]).find(Boolean);
    let q: string | undefined;
    const read = lines.flatMap((l): AskOption[] => {
        const h = /^question:\s*(.+)$/i.exec(l);
        if (h) return void (q = h[1].slice(0, 80)), [];
        const o = /^option:\s*(.+?)(?:\s+[—–-]\s+(.+))?$/i.exec(l);
        return o ? [{ label: o[1].slice(0, 80), ...(o[2] ? { then: o[2].slice(0, 160) } : {}), ...(q ? { q } : {}) }] : [];
    });
    const several = optionGroups(read).length > 1;
    const options = several ? read.slice(0, GROUPED_MAX) : read.slice(0, OPTION_MAX).map(({ q: _, ...o }) => o);
    return { kind: kind as AskKind, ...(text ? { text: clip(text) } : {}), by: "model", ...(context ? { context: context.slice(0, 240) } : {}), ...(options.length >= 2 ? { options } : {}) };
}

// When the model can't be asked: a question near the end asks, anything else only reports.
export function guessAsk(message: string): Ask | "done" {
    const tail = message.replace(/[*_`]+/g, "").slice(-QUESTION_TAIL);
    const question = tail.match(/[^.!?\n]*\?/g)?.pop()?.replace(/^[\s>*+-]+/, "").trim();
    return question ? { kind: "answer", text: clip(question), by: "guess" } : "done";
}

export const isAskKind = (k: unknown): k is AskKind => (ASK_KINDS as readonly unknown[]).includes(k);

const LINE_MAX = 240;
const OPTION_MAX = 4;
const GROUPED_MAX = 8;

// A card's questions: runs of options that answer the same one, as 1-based ranges. A card without
// questions is one group.
export function optionGroups(options: AskOption[]): { q?: string; from: number; to: number }[] {
    const out: { q?: string; from: number; to: number }[] = [];
    options.forEach((o, i) => {
        const last = out[out.length - 1];
        if (last && last.q === o.q) last.to = i + 1;
        else out.push({ ...(o.q ? { q: o.q } : {}), from: i + 1, to: i + 1 });
    });
    return out;
}
// One key each on the card, a to i without e (your own answer).
const PICK_MAX = 8;
const oneLine = (v: unknown, max: number) => typeof v === "string" && v.trim() !== "" && !/[\n\r]/.test(v) && v.trim().length <= max;

// A decision card from `wintos ask` (context, why, options, recommend, final), or why it is refused.
export function askCard(b: { context?: unknown; why?: unknown; options?: unknown; recommend?: unknown; final?: unknown; picks?: unknown }): AskCard | string {
    const card: AskCard = {};
    for (const k of ["context", "why"] as const) {
        if (b[k] === undefined) continue;
        if (!oneLine(b[k], LINE_MAX)) return `${k}: one line, up to ${LINE_MAX} characters`;
        card[k] = (b[k] as string).trim();
    }
    if (b.options !== undefined) {
        const options = Array.isArray(b.options) ? b.options : [];
        const fields = options.every((o) => o && oneLine(o.label, 80) && (o.then === undefined || oneLine(o.then, 160)) && (o.q === undefined || oneLine(o.q, 80)));
        const groups = fields ? optionGroups(options) : [];
        const ok = fields && options.length <= (groups.length > 1 ? GROUPED_MAX : OPTION_MAX) && groups.every((g) => g.to - g.from >= 1 && g.to - g.from < OPTION_MAX);
        if (!ok) return `options: 2 to ${OPTION_MAX} per question (q), up to ${GROUPED_MAX} in all, each a label up to 80 characters and an optional "then" up to 160`;
        card.options = options.map((o) => ({ label: o.label.trim(), ...(o.then ? { then: o.then.trim() } : {}), ...(groups.length > 1 && o.q ? { q: o.q.trim() } : {}) }));
    }
    if (b.recommend !== undefined) {
        if (optionGroups(card.options ?? []).length > 1) return "recommend: not on a card that asks several questions";
        if (!Number.isInteger(b.recommend) || (b.recommend as number) < 1 || (b.recommend as number) > (card.options?.length ?? 0)) return "recommend: the number of one of the options, from 1";
        card.recommend = b.recommend as number;
    }
    if (b.final === true) card.final = true;
    if (b.picks !== undefined) {
        const picks = Array.isArray(b.picks) ? b.picks : [];
        if (!(picks.length >= 1 && picks.length <= PICK_MAX && picks.every((p) => p && oneLine(p.label, 160)))) return `picks: 1 to ${PICK_MAX}, each a label up to 160 characters`;
        card.picks = picks.map((p) => ({ label: p.label.trim(), on: p.on === true }));
    }
    return card;
}
