export type HookPayload = { hook_event_name: string; session_id: string; cwd?: string; prompt?: string };
export type HookEvent = { tabId: string; blockId: string; payload: HookPayload };
export type SessionState = "idle" | "working" | "waiting" | "ended";
export type Session = {
    id: string;
    tabId: string;
    blockId: string;
    state: SessionState;
    since: number;
    lastAt: number;
    cwd?: string;
    label?: string;
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
    const state = next ?? prev?.state ?? "idle";
    const session: Session = {
        id,
        tabId: ev.tabId,
        blockId: ev.blockId,
        state,
        since: next && next !== prev?.state ? now : (prev?.since ?? now),
        lastAt: now,
        cwd: cwd ?? prev?.cwd,
        label: prev?.label ?? labelOf(typeof prompt === "string" ? prompt : undefined),
    };
    return new Map(sessions).set(id, session);
}
