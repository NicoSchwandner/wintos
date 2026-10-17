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
