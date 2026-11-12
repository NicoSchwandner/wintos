import type { Session } from "../sessions/reduce";
import type { Links } from "./roadmap";

// The epic agent passing on what you told it to one of its sessions. WintOS types it into that
// session's pane as a prompt, so it arrives as yours; and only words you did say to the agent go
// through, so the agent cannot speak for you. Its own note may come along, marked as its own.
// own: the agent's own words (wintos tell), marked as its, never as yours.
// about: a PR the receiver owns, told by another session (wintos tell --pr); fromName names it.
export type Relay = { text: string; note?: string; from: string; at: number; own?: true; about?: string; fromName?: string };
export type Relays = Record<string, Relay[]>;

// The session meant: by its name, its id's start, or a roadmap step it is linked to; exact first,
// then the one that starts with it. Several starting with it is none: the sessions an agent starts
// all begin with the epic's name, and the first of them was often the wrong one. Only the epic's own open sessions, never the agent itself.
// epic undefined: the sessions in no epic (wintos adopt takes one of them in).
export function findWorker(sessions: Session[], epic: string | undefined, agent: string, q: string, links: Links = {}): Session | undefined {
    const want = q.trim().toLowerCase();
    const open = sessions.filter((s) => s.epic === epic && s.id !== agent && s.state !== "ended");
    const names = (s: Session) => [s.name?.text, s.label, s.id, ...Object.entries(links).filter(([, ids]) => ids.includes(s.id)).map(([step]) => step)].filter((x): x is string => !!x).map((x) => x.toLowerCase());
    const exact = open.find((s) => names(s).includes(want));
    if (exact || want.length < 3) return exact;
    const starts = open.filter((s) => names(s).some((n) => n.startsWith(want)));
    return starts.length === 1 ? starts[0] : undefined;
}

const plain = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
// Words you said: part of your last prompt to the agent, spaces and case aside.
export const youSaid = (prompt: string | undefined, words: string) => !!prompt && !!plain(words) && plain(prompt).includes(plain(words));

export function relayPrompt(r: Relay, epic: string): string {
    if (r.about) return `[Session "${r.fromName ?? r.from}", not the developer, about your PR ${r.about}] ${r.text}`;
    if (r.own) return `[The ${epic} agent, not the developer] ${r.text}`;
    return `[You, via the ${epic} agent] ${r.text}${r.note ? `\n[The ${epic} agent's note, not the developer's: ${r.note}]` : ""}`;
}

export const addRelay = (relays: Relays, to: string, r: Relay): Relays => ({ ...relays, [to]: [...(relays[to] ?? []), r] });
export function relaysDelivered(relays: Relays, to: string, n: number): Relays {
    const left = (relays[to] ?? []).slice(n);
    const { [to]: _, ...rest } = relays;
    return left.length ? { ...rest, [to]: left } : rest;
}
