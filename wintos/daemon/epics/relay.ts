import type { Session } from "../sessions/reduce";
import type { Links } from "./roadmap";

// The epic agent passing on what you told it to one of its sessions. WintOS types it into that
// session's pane as a prompt, so it arrives as yours; and only words you did say to the agent go
// through, so the agent cannot speak for you. Its own note may come along, marked as its own.
// own: the agent's own words (wintos tell), marked as its, never as yours.
export type Relay = { text: string; note?: string; from: string; at: number; own?: true };
export type Relays = Record<string, Relay[]>;

// The session meant: by its name, its id's start, or a roadmap step it is linked to; exact first,
// then the first that starts with it. Only the epic's own open sessions, never the agent itself.
export function findWorker(sessions: Session[], epic: string, agent: string, q: string, links: Links = {}): Session | undefined {
    const want = q.trim().toLowerCase();
    const open = sessions.filter((s) => s.epic === epic && s.id !== agent && s.state !== "ended");
    const names = (s: Session) => [s.name?.text, s.label, s.id, ...Object.entries(links).filter(([, ids]) => ids.includes(s.id)).map(([step]) => step)].filter((x): x is string => !!x).map((x) => x.toLowerCase());
    return open.find((s) => names(s).includes(want)) ?? (want.length >= 3 ? open.find((s) => names(s).some((n) => n.startsWith(want))) : undefined);
}

const plain = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
// Words you said: part of your last prompt to the agent, spaces and case aside.
export const youSaid = (prompt: string | undefined, words: string) => !!prompt && !!plain(words) && plain(prompt).includes(plain(words));

export function relayPrompt(r: Relay, epic: string): string {
    if (r.own) return `[The ${epic} agent, not the developer] ${r.text}`;
    return `[You, via the ${epic} agent] ${r.text}${r.note ? `\n[The ${epic} agent's note, not the developer's: ${r.note}]` : ""}`;
}

export const addRelay = (relays: Relays, to: string, r: Relay): Relays => ({ ...relays, [to]: [...(relays[to] ?? []), r] });
export function relaysDelivered(relays: Relays, to: string, n: number): Relays {
    const left = (relays[to] ?? []).slice(n);
    const { [to]: _, ...rest } = relays;
    return left.length ? { ...rest, [to]: left } : rest;
}
