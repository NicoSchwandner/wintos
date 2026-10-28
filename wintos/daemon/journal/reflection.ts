// The weekly, monthly, quarterly and yearly reflections the journal's own tool puts on a Friday:
// a "## <Level> reflection" section of questions, answered in place.

export const LEVELS = ["weekly", "monthly", "quarterly", "yearly"] as const;
export type Level = (typeof LEVELS)[number];
export const rank = (l: Level) => LEVELS.indexOf(l);

const HEADING = /^## (Weekly|Monthly|Quarterly|Yearly) [Rr]eflection.*$/m;
const PLACEHOLDER = /^\s*-\s*(\[ \]\s*)?(\.\.\.)?\s*$/;

const section = (md: string) => {
    const h = HEADING.exec(md);
    if (!h) return undefined;
    const start = h.index + h[0].length;
    const next = /^## /m.exec(md.slice(start));
    return { h, start, end: next ? start + next.index : md.length };
};

export function reflectionOf(md: string): { level: Level; title: string; body: string } | undefined {
    const s = section(md);
    if (!s) return undefined;
    return { level: s.h[1].toLowerCase() as Level, title: s.h[0].slice(3).trim(), body: md.slice(s.start, s.end).trim() };
}

export function withReflection(md: string, body: string): string {
    const s = section(md);
    if (!s) return md;
    return `${md.slice(0, s.start)}\n\n${body.trim()}\n\n${md.slice(s.end).replace(/^\n+/, "")}`.replace(/\n+$/, "\n");
}

// A question: a ### heading or a bold bullet. What you wrote is every line the template doesn't
// have, each under the question it sits below, so a look-back reads as answers, not as the form.
const isQuestion = (l: string) => /^###\s/.test(l) || /^-\s+\*\*/.test(l);
export function answersOf(body: string, template: string): string {
    const known = new Set(template.split("\n").map((l) => l.trim()));
    const out: string[] = [];
    let question: string | undefined;
    for (const l of body.split("\n")) {
        if (!l.trim() || PLACEHOLDER.test(l)) continue;
        if (known.has(l.trim())) {
            if (isQuestion(l)) question = l;
            continue;
        }
        if (question) out.push(question), (question = undefined);
        out.push(l);
    }
    return out.join("\n");
}

// The goals a day sets for what comes next: tomorrow's in a daily, the next week's, month's,
// quarter's or year's in a reflection, and what Monday morning starts with. Only real checkbox
// items count: the questions between them are the template's.
const GOALS = /Goals and (Tasks|Plans) for|What do I start working on Monday morning/i;
export function goalsAhead(md: string): string[] {
    const lines = md.split("\n");
    const out: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        if (!GOALS.test(lines[i]) || !isQuestion(lines[i])) continue;
        const heading = /^###\s/.test(lines[i]);
        for (const l of lines.slice(i + 1)) {
            if (/^#/.test(l) || (!heading && !/^\s+\S/.test(l))) break;
            if (/^\s*-\s+\[[ xX~]\]\s+\S/.test(l) && !PLACEHOLDER.test(l)) out.push(l.trim());
        }
    }
    return out;
}
