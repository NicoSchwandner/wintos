import type { Session } from "./reduce";

// Three lines for coming back to a session after a while: what you last asked it, what it did
// (its latest recap, else how its last turn ended), and what it needs of you now, if anything.
// reply: all the last turn wrote, for a decision that needs its background.
export type Reentry = { asked?: string; did?: string; needs?: string; reply?: string };
const REPLY_MAX = 12_000;

const KIND_WORD = { answer: "Answer", decide: "Decide", approve: "Approve", unblock: "Unblock" } as const;

// Everything the last turn wrote since your prompt: a session asking through `wintos ask` gives its
// background before that call, so stopping at the last tool call would drop it. The end is kept.
export function lastReply(jsonl: string): string | undefined {
    let texts: string[] = [];
    for (const line of jsonl.split("\n")) {
        let e: { type?: string; isMeta?: boolean; message?: { content?: unknown } };
        try {
            e = JSON.parse(line);
        } catch {
            continue;
        }
        const content = e.message?.content;
        if (e.type === "user" && !e.isMeta && typeof content === "string") texts = [];
        if (e.type === "assistant" && Array.isArray(content)) {
            for (const c of content as { type?: string; text?: string }[]) {
                if (c.type === "text" && c.text?.trim()) texts.push(c.text.trim());
            }
        }
    }
    const reply = texts.join("\n\n");
    return reply ? reply.slice(-REPLY_MAX) : undefined;
}

export function reentry(s: Session, prompts: string[], gist: string | undefined, reply?: string): Reentry {
    const asked = prompts[prompts.length - 1];
    const did = gist ?? s.outcome?.text ?? s.status?.text;
    const needs = s.state === "waiting" ? (s.ask ? [KIND_WORD[s.ask.kind], s.ask.text].filter(Boolean).join(" · ") : "Your turn") : s.state === "parked" && s.parkedOn ? `nothing: it waits on ${s.parkedOn}` : undefined;
    return { ...(asked ? { asked } : {}), ...(did ? { did } : {}), ...(needs ? { needs } : {}), ...(reply ? { reply } : {}) };
}
