import type { Session } from "../sessions/reduce";
import type { Shelf } from "../shelf/shelf";

// Who owns which PR, set from outside: url → session id, or null for nobody. Each PR named ends up
// with that one owner, live or on the shelf; a PR not named, or named for a session WintOS
// doesn't know, stays as it is.
export function reassignPrs(sessions: Map<string, Session>, shelf: Shelf, owners: Record<string, string | null>): { sessions: Map<string, Session>; shelf: Shelf } {
    const known = new Set([...sessions.keys(), ...Object.values(shelf).flat().map((i) => i.sessionId)]);
    const moves = Object.entries(owners).filter(([, id]) => id === null || known.has(id));
    const moved = new Set(moves.map(([u]) => u));
    const prsOf = (id: string, prs: string[] = []) => [...prs.filter((u) => !moved.has(u)), ...moves.filter(([, o]) => o === id).map(([u]) => u)];
    const out = new Map([...sessions].map(([id, x]) => [id, { ...x, prs: prsOf(id, x.prs) }]));
    const outShelf = Object.fromEntries(Object.entries(shelf).map(([f, list]) => [f, list.map((i) => ({ ...i, prs: prsOf(i.sessionId, i.prs) }))]));
    return { sessions: out, shelf: outShelf };
}

// A session touched these PRs (a gh pr command that acts on one, or `wintos pr`). The first
// session to touch a PR owns it, live or on the shelf; a later one gets it as "also in" (touched).
// take: the session takes the PR over (`wintos pr --own`), and the old owner keeps it as also-in.
export function touchPrs(sessions: Map<string, Session>, shelf: Shelf, sessionId: string, links: string[], take = false): { sessions: Map<string, Session>; shelf: Shelf } {
    const me = sessions.get(sessionId);
    if (!me || !links.length) return { sessions, shelf };
    const ownedElsewhere = new Set([...[...sessions.values()].filter((s) => s.id !== sessionId).flatMap((s) => s.prs ?? []), ...Object.values(shelf).flat().filter((i) => i.sessionId !== sessionId).flatMap((i) => i.prs ?? [])]);
    const mine = new Set(me.prs ?? []);
    const toOwn = links.filter((u) => !mine.has(u) && (take || !ownedElsewhere.has(u)));
    const alsoIn = links.filter((u) => !mine.has(u) && !toOwn.includes(u));
    const moved = new Set(take ? toOwn : []);
    const add = (list: string[] | undefined, more: string[]) => [...new Set([...(list ?? []), ...more])];
    // The old owner of a PR taken over keeps it as also-in.
    const demote = <T extends { prs?: string[]; touched?: string[] }>(x: T): T => {
        const lost = (x.prs ?? []).filter((u) => moved.has(u));
        return lost.length ? { ...x, prs: (x.prs ?? []).filter((u) => !moved.has(u)), touched: add(x.touched, lost) } : x;
    };
    const out = new Map([...sessions].map(([id, s]) => [id, id === sessionId ? s : demote(s)]));
    out.set(sessionId, { ...me, prs: add(me.prs, toOwn), touched: add((me.touched ?? []).filter((u) => !toOwn.includes(u)), alsoIn) });
    const outShelf = Object.fromEntries(Object.entries(shelf).map(([f, list]) => [f, list.map((i) => demote(i))]));
    return { sessions: out, shelf: outShelf };
}
