import type { Session } from "../sessions/reduce";

// Sessions an epic's agent starts for its roadmap steps (`wintos start`). They run in Claude's
// background service, whose hooks never reach WintOS, so their state is read from
// `claude agents --json` instead: working, blocked (it waits for you) or done.
export type BgStart = { epic: string; step: string; name: string; agent: string; tabId: string; at: number };
export type BgStarts = Record<string, BgStart>; // by the short id `claude --bg` prints
export type BgAgent = { id: string; sessionId: string; state?: string; status?: string; cwd?: string };

export const BG_MAX = 3; // running at once per epic: the agent proposes work, it does not flood you
export const BG_ID = /^[0-9a-f]{8}$/;

export function parseAgents(json: string): BgAgent[] {
    try {
        const d = JSON.parse(json);
        const list: unknown[] = Array.isArray(d) ? d : Array.isArray(d?.agents) ? d.agents : [];
        return list.filter((a): a is BgAgent => !!a && typeof (a as BgAgent).id === "string" && typeof (a as BgAgent).sessionId === "string");
    } catch {
        return [];
    }
}

export function bgState(a: BgAgent | undefined): Session["state"] {
    if (!a) return "ended";
    if (a.state === "working" || a.status === "busy") return "working";
    if (a.state === "blocked") return "waiting";
    if (a.state === "done" || a.status === "idle") return "done";
    return "idle";
}

// The sessions as the background service says they are now. new: started sessions seen for the
// first time (to link to their step); moved: those whose state changed (to report up).
export function mergeBg(sessions: Map<string, Session>, starts: BgStarts, agents: BgAgent[], now: number): { sessions: Map<string, Session>; fresh: { id: string; start: BgStart }[]; moved: string[] } {
    const out = new Map(sessions);
    const fresh: { id: string; start: BgStart }[] = [];
    const moved: string[] = [];
    for (const [short, start] of Object.entries(starts)) {
        const a = agents.find((x) => x.id === short);
        const known = [...out.values()].find((s) => s.bgId === short);
        const state = bgState(a);
        if (!known) {
            if (!a) continue; // not listed yet: it is still starting
            out.set(a.sessionId, { id: a.sessionId, tabId: start.tabId, blockId: "", state, since: now, lastAt: now, background: true, bgId: short, epic: start.epic, name: { text: start.name, by: "session", at: now } } as Session);
            fresh.push({ id: a.sessionId, start });
            moved.push(a.sessionId);
            continue;
        }
        if (known.state === state || known.state === "ended") continue;
        const ask = state === "waiting" ? { ask: { kind: "answer" as const, text: "it waits for your answer", by: "guess" as const } } : { ask: undefined };
        out.set(known.id, { ...known, state, since: now, lastAt: now, ...ask });
        moved.push(known.id);
    }
    return { sessions: out, fresh, moved };
}

export const liveStarts = (starts: BgStarts, sessions: Map<string, Session>, epic: string) =>
    Object.entries(starts).filter(([short, s]) => s.epic === epic && [...sessions.values()].find((x) => x.bgId === short)?.state !== "ended").length;
