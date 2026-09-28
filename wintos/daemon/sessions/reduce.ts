export type HookPayload = { hook_event_name: string; session_id: string; cwd?: string; prompt?: string };
export type HookEvent = { tabId: string; blockId: string; payload: HookPayload };
// parked: the turn ended waiting on something outside (CI, a review), not on the developer.
// done: the turn ended with the goal met and nothing asked of the developer.
export type SessionState = "idle" | "working" | "waiting" | "parked" | "done" | "ended";
export type Session = {
    id: string;
    tabId: string;
    blockId: string;
    state: SessionState;
    since: number;
    lastAt: number;
    cwd?: string;
    label?: string;
    parkedOn?: string;
    parkPending?: boolean; // `wintos wait` ran this turn; the turn's Stop parks instead of waiting
    donePending?: boolean; // `wintos done` ran this turn; the turn's Stop ends it done
    restored?: boolean; // saved at the last quit, its Claude not started again yet
};

const LABEL_MAX = 24;
const labelOf = (prompt?: string) =>
    prompt && (prompt.length > LABEL_MAX ? `${prompt.slice(0, LABEL_MAX - 1).trimEnd()}…` : prompt);

// Only these events move a session. SubagentStop fires when a subagent finishes while the
// main loop keeps working, and Notification fires for attachments and permission prompts;
// cmux folded both into "needs input", which is what made its NEEDS YOU unreliable.
const TRANSITIONS: Record<string, SessionState> = {
    SessionStart: "idle",
    UserPromptSubmit: "working",
    Stop: "waiting",
    SessionEnd: "ended",
};

export function reduceSession(sessions: Map<string, Session>, ev: HookEvent, now: number): Map<string, Session> {
    const { session_id: id, hook_event_name: name, cwd, prompt } = ev.payload;
    const prev = sessions.get(id);
    // A resumed session starting up is still where it was at quit (a turn waiting on you).
    const next = prev?.restored && name === "SessionStart" ? undefined : TRANSITIONS[name];
    const parks = name === "Stop" && prev?.parkPending;
    const finishes = name === "Stop" && prev?.donePending;
    const state = parks ? "parked" : finishes ? "done" : (next ?? prev?.state ?? "idle");
    const session: Session = {
        id,
        tabId: ev.tabId,
        blockId: ev.blockId,
        state,
        since: next && next !== prev?.state ? now : (prev?.since ?? now),
        lastAt: now,
        cwd: cwd ?? prev?.cwd,
        label: prev?.label ?? labelOf(typeof prompt === "string" ? prompt : undefined),
        // A parked mark lasts one turn: the next Stop or prompt decides afresh.
        parkedOn: parks ? prev.parkedOn : next ? undefined : prev?.parkedOn,
        parkPending: next ? undefined : prev?.parkPending,
        donePending: next ? undefined : prev?.donePending,
    };
    const out = new Map(sessions);
    // The block's saved entry is replaced by whatever session now reports from it.
    for (const s of sessions.values()) if (s.restored && s.blockId === ev.blockId && s.id !== id) out.delete(s.id);
    return out.set(id, session);
}

// Sessions saved at the last quit. The restart cut off any turn in progress; ended ones are gone.
export function restoreSessions(saved: Session[]): Map<string, Session> {
    const out = new Map<string, Session>();
    for (const s of saved) {
        if (s.state === "ended") continue;
        out.set(s.id, { ...s, state: s.state === "working" ? "idle" : s.state, restored: true });
    }
    return out;
}

// `wintos wait "<what>"` from inside a session: the block's live session ends this turn parked.
export function parkSession(sessions: Map<string, Session>, blockId: string, reason: string, now: number): Map<string, Session> {
    const live = liveIn(sessions, blockId);
    if (!live) return sessions;
    return new Map(sessions).set(live.id, { ...live, parkedOn: reason, parkPending: true, donePending: undefined, lastAt: now });
}

// `wintos done` from inside a session: the block's live session ends this turn done.
export function finishSession(sessions: Map<string, Session>, blockId: string, now: number): Map<string, Session> {
    const live = liveIn(sessions, blockId);
    if (!live) return sessions;
    return new Map(sessions).set(live.id, { ...live, donePending: true, parkPending: undefined, lastAt: now });
}

const liveIn = (sessions: Map<string, Session>, blockId: string) =>
    [...sessions.values()].filter((s) => s.blockId === blockId && s.state !== "ended").sort((a, b) => b.lastAt - a.lastAt)[0];
