import { resumeScriptOf, type Session } from "../sessions/reduce";
import { shelvedName, type Shelf } from "../shelf/shelf";

// Who owns a PR, and how something said about it reaches them: typed into their pane between
// turns, sent through Claude's background service, resumed in their pane first (paused or not yet
// started since a restart), or resumed headless (ended or shelved: always, however long ago).
export type OwnerRoute = "pane" | "background" | "paused" | "shelved" | "none";
export type Owner = { route: OwnerRoute; sessionId?: string; name?: string; epic?: string; script?: string };

const nameOf = (s: Session) => s.name?.text ?? s.label ?? s.id.slice(0, 8);

export function ownerOf(url: string, sessions: Session[], shelf: Shelf): Owner {
    const holders = sessions.filter((s) => s.prs?.includes(url));
    const live = holders.find((s) => s.state !== "ended");
    if (live) {
        const at = { sessionId: live.id, name: nameOf(live), ...(live.epic ? { epic: live.epic } : {}) };
        if (live.bgId && !live.attachedTo) return { route: "background", ...at };
        if (!live.restored) return { route: "pane", ...at };
        const script = resumeScriptOf(live);
        return script && live.blockId ? { route: "paused", ...at, script } : { route: "none" };
    }
    const ended = holders.map((s) => ({ s, script: resumeScriptOf(s) })).find((x) => x.script);
    if (ended) return { route: "shelved", sessionId: ended.s.id, name: nameOf(ended.s), ...(ended.s.epic ? { epic: ended.s.epic } : {}), script: ended.script };
    const kept = Object.values(shelf).flat().find((i) => i.prs?.includes(url));
    if (kept) return { route: "shelved", sessionId: kept.sessionId, name: shelvedName(kept), ...(kept.epic ? { epic: kept.epic } : {}), script: kept.script };
    return { route: "none" };
}

// A PR whose owner could not be found, or that a session took over: each line is a case of PR
// registration missing a PR, kept for whoever fixes registration (WintOS heads-up, /evolve).
export type Gap = { at: number; pr: string; kind: "no-owner" | "took-over"; by?: string; byName?: string; reason?: string; checked: string[] };
export const GAP_SOURCES = ["live sessions", "ended sessions", "shelf"];
