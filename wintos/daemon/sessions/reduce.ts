export type HookPayload = { hook_event_name: string; session_id: string; cwd?: string; prompt?: string };
export type HookEvent = { tabId: string; blockId: string; payload: HookPayload };
// parked: the turn ended waiting on something outside (CI, a review), not on the developer.
export type SessionState = "idle" | "working" | "waiting" | "parked" | "ended";
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
    const next = TRANSITIONS[name];
    const parks = name === "Stop" && prev?.parkPending;
    const state = parks ? "parked" : (next ?? prev?.state ?? "idle");
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
    };
    return new Map(sessions).set(id, session);
}

// `wintos wait "<what>"` from inside a session: the block's live session ends this turn parked.
export function parkSession(sessions: Map<string, Session>, blockId: string, reason: string, now: number): Map<string, Session> {
    const live = [...sessions.values()].filter((s) => s.blockId === blockId && s.state !== "ended").sort((a, b) => b.lastAt - a.lastAt)[0];
    if (!live) return sessions;
    return new Map(sessions).set(live.id, { ...live, parkedOn: reason, parkPending: true, lastAt: now });
}
