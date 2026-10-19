import type { PR } from "../prs/group";
// What you did on a day, for the daily: the projects you spent time in, each with what its PRs did
// and the recaps its Claude sessions wrote, condensed to a bullet per real chunk of work. The daemon records which project each
// session ran in as the events arrive, since a transcript only knows its folder and a session
// started in a repo belongs to whatever project's tab it ran in.

export type Activity = Record<string, Record<string, { title: string; prompts: number; sessions: Record<string, string> }>>; // day → tab → …
// minutes: how long its sessions were busy that day; facts: what its PRs did, one line each.
// asked: what the developer asked its sessions, for a project whose sessions wrote no recap.
export type RecapItem = { title: string; minutes: number; prompts: number; recaps: string[]; facts: string[]; asked?: string[] };

export function recordActivity(a: Activity, day: string, tabId: string, title: string, sessionId: string, transcript: string, prompt: boolean, keepDays: number): Activity {
    const was = a[day]?.[tabId];
    const entry = { title, prompts: (was?.prompts ?? 0) + (prompt ? 1 : 0), sessions: { ...was?.sessions, [sessionId]: transcript } };
    const next = { ...a, [day]: { ...a[day], [tabId]: entry } };
    const from = new Date(`${day}T12:00:00`);
    from.setDate(from.getDate() - keepDays);
    const oldest = from.toISOString().slice(0, 10);
    return Object.fromEntries(Object.entries(next).filter(([d]) => d >= oldest));
}

// The day's last recap in a transcript (Claude Code's away summary). Timestamps are UTC, so a
// late-evening recap can land on the next day's date; good enough for a daily. Day "": any day.
export function lastRecaps(jsonl: string, day: string): string | undefined {
    let last: string | undefined;
    for (const line of jsonl.split("\n")) {
        if (!line.includes("away_summary") || !line.includes(day)) continue;
        try {
            const e = JSON.parse(line);
            if (e.subtype === "away_summary" && String(e.timestamp).startsWith(day) && typeof e.content === "string") last = e.content.replace(/\s+/g, " ").trim();
        } catch {}
    }
    return last;
}

// A sanity cap, not a target: one bullet per real chunk of work.
const MAX = 12;
// The cut-down fallback without a summarizer stays short.
const FALLBACK_MAX = 5;
// Under this, a project is noise unless one of its PRs did something that day.
export const MIN_MINUTES = 10;
// A gap longer than this between a session's messages is a break, not work.
const BREAK_MS = 5 * 60_000;

export const localDay = (t: number) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// How long a session was busy on a day, from its transcript's timestamps.
export function activeMinutes(jsonl: string, day: string): number {
    const ts: number[] = [];
    for (const line of jsonl.split("\n")) {
        try {
            const e = JSON.parse(line) as { type?: string; timestamp?: string };
            const at = Date.parse(e.timestamp ?? "");
            if (at && (e.type === "user" || e.type === "assistant") && localDay(at) === day) ts.push(at);
        } catch {}
    }
    ts.sort((a, b) => a - b);
    let busy = 0;
    for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] < BREAK_MS) busy += ts[i] - ts[i - 1];
    return Math.round(busy / 60_000);
}
// Ticket ids (ABC-1234) mean nothing a day later; the project's name says what it was.
const noTickets = (s: string) => s.replace(/\s*\(?\b[A-Z][A-Z0-9]+-\d+\b\)?/g, "").replace(/\s{2,}/g, " ").trim();
const short = (s: string, n = 110) => (s.length > n ? `${s.slice(0, s.lastIndexOf(" ", n - 1))}…` : s);

const firstSentence = (s: string) => /^.*?[.!?](?=\s|$)/.exec(s)?.[0] ?? s;
export const gist = (recap: string) => short(firstSentence(noTickets(recap)));

export function cutBullets(items: RecapItem[]): string[] {
    return items.slice(0, FALLBACK_MAX).map((i) => short(`${i.title}: ${firstSentence(noTickets(i.recaps[i.recaps.length - 1] ?? ""))}`));
}

// extra: the user's own addition, e.g. another source to search; {day} becomes the day.
export function recapPrompt(day: string, items: RecapItem[], extra?: string): string {
    return [
        `Write what a developer did on ${day}, for their team's daily standup: what their colleagues want to hear.`,
        `Below are the projects they worked in, most time first, each with the minutes its coding sessions were busy, what its pull requests did that day, and the summaries the sessions wrote.`,
        `Rules:`,
        `- One bullet per real chunk of work, as many as there were, most time first. A project can be more than one chunk, or none.`,
        `- Product and feature work first, then support or incidents, then tooling the team shares. Judge each project by its work, not its repository: one repository can hold several kinds.`,
        `- Leave out work on tools only the developer uses: repositories under their own GitHub account (not their organisation's), their personal settings, rules or skills. A tool the team uses is team tooling and stays.`,
        `- Leave out reviews of other people's pull requests, unless they reviewed 4 or more that day: then one bullet, "Review race: reviewed N pull requests".`,
        `- Say what changed for the product or the team, with the pull requests' outcomes (opened, ready for review, merged). Never mention CI, Copilot, commits, pushes, tests passing, logins or other process steps.`,
        `- Start each bullet with a short name for the work and a colon; never mention ticket ids like ABC-1234; under 160 characters each.`,
        `Output only the bullets, each line starting with "- ".`,
        ...(extra ? [extra.split("{day}").join(day)] : []),
        "",
        ...items.map((i) => [`## ${i.title} (${i.minutes} min)`, ...i.facts.map((f) => `- PR ${f}`), ...i.recaps.map((r) => `- ${r}`), ...(i.asked ?? []).map((a) => `- Asked: ${a}`)].join("\n")),
    ].join("\n");
}

export function parseBullets(out: string): string[] {
    return out
        .split("\n")
        .map((l) => /^\s*[-*•]\s+(.*)$/.exec(l)?.[1])
        .filter((l): l is string => !!l?.trim())
        .map(noTickets)
        .slice(0, MAX);
}

// The day a summary is about: the last workday before today with work in it. A weekend's
// sessions are not the day Monday carries on from (the journal skips them too).
export function lastWorkday(days: string[], today: string): string | undefined {
    return days.filter((d) => d < today && ![0, 6].includes(new Date(`${d}T12:00:00`).getDay())).sort().pop();
}

// A project reopened in a new tab is recorded under each tab: one item per project, its time added up.
export function mergeByTitle(items: RecapItem[]): RecapItem[] {
    const by = new Map<string, RecapItem>();
    for (const i of items) {
        const was = by.get(i.title);
        by.set(i.title, was ? { ...was, minutes: was.minutes + i.minutes, prompts: was.prompts + i.prompts, recaps: [...was.recaps, ...i.recaps], facts: [...new Set([...was.facts, ...i.facts])], asked: [...(was.asked ?? []), ...(i.asked ?? [])] } : i);
    }
    return [...by.values()];
}

// One line on what a PR did, for the standup: whose it is and where it got to that day.
export function prFact(pr: PR, me: string, day: string): string {
    const on = (iso?: string) => !!iso && localDay(Date.parse(iso)) === day;
    const where = pr.mergedAt ? (on(pr.mergedAt) ? "merged today" : "merged") : [on(pr.createdAt) && "opened today", pr.isDraft ? "draft" : "ready for review"].filter(Boolean).join(", ");
    return `${pr.repo}#${pr.number} ${pr.title} (${pr.author === me ? "yours" : `by ${pr.author}`}, ${where})`;
}
