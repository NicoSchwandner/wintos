// A day in numbers, from the prompts you sent that day: how many sessions you worked with, the
// longest stretch without a 10-minute gap, the breaks (gaps of 20 minutes or more), when you
// stopped, and how often the next prompt went to another session.
export type DayNumbers = { prompts: number; sessions: number; longestMs: number; breaks: number; firstAt: number; lastAt: number; switchPct: number };

const GAP_MS = 10 * 60_000;
const BREAK_MS = 20 * 60_000;

export function dayNumbers(prompts: { at: number; sessionId: string }[]): DayNumbers | undefined {
    const p = [...prompts].sort((a, b) => a.at - b.at);
    if (!p.length) return undefined;
    let longestMs = 0;
    let start = p[0].at;
    let breaks = 0;
    let switches = 0;
    let pairs = 0;
    for (let i = 1; i < p.length; i++) {
        const gap = p[i].at - p[i - 1].at;
        if (gap >= BREAK_MS) breaks++;
        if (gap < GAP_MS) longestMs = Math.max(longestMs, p[i].at - start);
        else start = p[i].at;
        if (gap < 3_600_000) (pairs++, p[i].sessionId !== p[i - 1].sessionId && switches++);
    }
    return { prompts: p.length, sessions: new Set(p.map((x) => x.sessionId)).size, longestMs, breaks, firstAt: p[0].at, lastAt: p[p.length - 1].at, switchPct: pairs ? Math.round((100 * switches) / pairs) : 0 };
}

// The prompts in a transcript sent on the day: yours, not tool results or the harness's own.
export function promptTimes(jsonl: string, day: string, localDay: (t: number) => string): number[] {
    const out: number[] = [];
    for (const line of jsonl.split("\n")) {
        if (!line.includes('"type":"user"')) continue;
        try {
            const e = JSON.parse(line) as { type?: string; isMeta?: boolean; isSidechain?: boolean; timestamp?: string; message?: { content?: unknown } };
            const at = Date.parse(e.timestamp ?? "");
            const text = typeof e.message?.content === "string" ? e.message.content.trim() : "";
            if (at && !e.isMeta && !e.isSidechain && text && !text.startsWith("<") && !text.startsWith("[WintOS wake") && localDay(at) === day) out.push(at);
        } catch {}
    }
    return out;
}
