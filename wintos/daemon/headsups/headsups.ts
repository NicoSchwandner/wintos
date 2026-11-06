// Heads-ups from Claude Code's built-in "You should know" plugin, kept per project until closed.
// The plugin's store is internal to Claude Code and can change with any release, so it is read
// defensively, and watchHealth notices when heads-ups stop arriving the way we read them.

export const STORE_PREFIX = "cc-plugin-you-should-know_";

export type HeadsUp = { id: string; sessionId: string; project: string; text: string; explanation?: string; at: number };
export type Offer = { sessionId: string; text: string; explanation?: string; at: number };
export type StoreRead = { offers: Offer[]; seen: string[] } | { problem: string };
export type Health = { missed: number; seen?: string[]; problem?: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function readStore(raw: unknown): StoreRead {
    if (!isObject(raw)) return { problem: "not an object" };
    if (!Array.isArray(raw.sessions)) return { problem: "no sessions list" };
    if (!Array.isArray(raw.seen) || !raw.seen.every((s) => typeof s === "string")) return { problem: "no seen list" };
    const offers: Offer[] = [];
    for (const s of raw.sessions) {
        if (!isObject(s) || typeof s.id !== "string") return { problem: "a session without an id" };
        const view = s.view;
        if (!isObject(view) || view.kind !== "offer") continue;
        if (typeof view.line !== "string" || typeof view.shownAt !== "number") return { problem: "an offer without its line or time" };
        offers.push({ sessionId: s.id, text: view.line, ...(typeof view.explanation === "string" ? { explanation: view.explanation } : {}), at: view.shownAt });
    }
    return { offers, seen: raw.seen as string[] };
}

// projectOf: the project folder a WintOS session belongs to; other sessions' offers are left out.
export function capture(list: HeadsUp[], offers: Offer[], projectOf: (sessionId: string) => string | undefined): HeadsUp[] {
    const have = new Set(list.map((h) => h.id));
    const added = offers.flatMap((o) => {
        const id = `${o.sessionId}:${o.at}`;
        const project = projectOf(o.sessionId);
        return have.has(id) || !project ? [] : [{ id, project, ...o }];
    });
    return added.length ? [...list, ...added] : list;
}

export const dismiss = (list: HeadsUp[], id: string): HeadsUp[] => (list.some((h) => h.id === id) ? list.filter((h) => h.id !== id) : list);

// The plugin appends each heads-up it shows to `seen` in the same write as the offer. A new seen
// line with no offer beside it is one we didn't read: once can be an offer answered before we
// looked; twice in a row means the offers moved.
const MISSES_TO_ALARM = 2;
export function watchHealth(h: Health, read: StoreRead): Health {
    if ("problem" in read) return { ...h, problem: `the store's shape changed: ${read.problem}` };
    if (!h.seen) return { missed: 0, seen: read.seen };
    const before = new Set(h.seen);
    const offered = new Set(read.offers.map((o) => o.text));
    const fresh = read.seen.filter((l) => !before.has(l));
    const missed = !fresh.length ? h.missed : fresh.every((l) => offered.has(l)) ? 0 : h.missed + 1;
    return { missed, seen: read.seen, ...(missed >= MISSES_TO_ALARM ? { problem: `${missed} heads-ups appeared without an offer to read: the plugin's store has probably changed` } : {}) };
}
