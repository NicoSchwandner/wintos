import type { Session } from "./reduce";

// Three lines for coming back to a session after a while: what you last asked it, what it did
// (its latest recap, else how its last turn ended), and what it needs of you now, if anything.
export type Reentry = { asked?: string; did?: string; needs?: string };

const KIND_WORD = { answer: "Answer", decide: "Decide", approve: "Approve", unblock: "Unblock" } as const;

export function reentry(s: Session, prompts: string[], gist: string | undefined): Reentry {
    const asked = prompts[prompts.length - 1];
    const did = gist ?? s.outcome?.text ?? s.status?.text;
    const needs = s.state === "waiting" ? (s.ask ? [KIND_WORD[s.ask.kind], s.ask.text].filter(Boolean).join(" · ") : "Your turn") : s.state === "parked" && s.parkedOn ? `nothing: it waits on ${s.parkedOn}` : undefined;
    return { ...(asked ? { asked } : {}), ...(did ? { did } : {}), ...(needs ? { needs } : {}) };
}
