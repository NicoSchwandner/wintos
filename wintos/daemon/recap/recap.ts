// What you did on a day, for the daily: the projects you worked in, each with the recaps its
// Claude sessions wrote, condensed to at most five bullets. The daemon records which project each
// session ran in as the events arrive, since a transcript only knows its folder and a session
// started in a repo belongs to whatever project's tab it ran in.

export type Activity = Record<string, Record<string, { title: string; prompts: number; sessions: Record<string, string> }>>; // day → tab → …
export type RecapItem = { title: string; prompts: number; recaps: string[] };

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
// late-evening recap can land on the next day's date; good enough for a daily.
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

const MAX = 5;
// Ticket ids (ABC-1234) mean nothing a day later; the project's name says what it was.
const noTickets = (s: string) => s.replace(/\s*\(?\b[A-Z][A-Z0-9]+-\d+\b\)?/g, "").replace(/\s{2,}/g, " ").trim();
const short = (s: string, n = 110) => (s.length > n ? `${s.slice(0, s.lastIndexOf(" ", n - 1))}…` : s);

export function cutBullets(items: RecapItem[]): string[] {
    return items.slice(0, MAX).map((i) => {
        const recap = noTickets(i.recaps[i.recaps.length - 1] ?? "");
        const first = /^.*?[.!?](?=\s|$)/.exec(recap)?.[0] ?? recap;
        return short(`${i.title}: ${first}`);
    });
}

// extra: the user's own addition, e.g. another source to search; {day} becomes the day.
export function recapPrompt(day: string, items: RecapItem[], extra?: string): string {
    return [
        `Write what someone did on ${day}, for their team's daily standup.`,
        `Below are the projects they worked in, most work first, each with the summaries their coding sessions wrote at the end of the day.`,
        `Rules: at most 5 bullet points; what was done, not what comes next; one bullet per project, but put all reviews of other people's pull requests into one "Reviews" bullet;`,
        `start each bullet with the project's short name and a colon; never mention ticket ids like ABC-1234; under 140 characters each.`,
        `Output only the bullets, each line starting with "- ".`,
        ...(extra ? [extra.split("{day}").join(day)] : []),
        "",
        ...items.map((i) => `## ${i.title} (${i.prompts} prompts)\n${i.recaps.map((r) => `- ${r}`).join("\n")}`),
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
