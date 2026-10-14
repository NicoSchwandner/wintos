export type HookPayload = { hook_event_name: string; session_id: string; cwd?: string; prompt?: string; prs?: unknown; pr_verb?: string; resume?: string };
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
    prs?: string[]; // PR links its gh pr commands named, oldest first
    status?: { text: string; at: number }; // its own line on what it is doing (`wintos status`)
    lane?: Lane; // the process it follows and where it is in it (`wintos lane`, `wintos step`)
    turnEndedAt?: number; // the last Stop: a reply the developer may not have read yet
    promptAt?: number; // the last prompt: in a pane running two sessions, the one you talk to
    resume?: string; // the pane's resume command for it: only the session the pane runs sends one
};

// A step starting with ? is the developer's call: the session stops there.
// todos: what is in flight in the step now (`wintos todo`); the next step starts without them.
export type Todo = { text: string; done: boolean };
export type Lane = { name: string; steps: string[]; at: number; note?: string; todos?: Todo[] };

const LABEL_MAX = 24;
// One gh pr command names a PR or two (a stack); more is a listing, which claims nothing.
const MAX_PRS_PER_CALL = 3;
const PR_LINK = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;

// The PR links a call names, if it names few enough to be about them.
function prLinks(named: unknown): string[] {
    const links = Array.isArray(named) ? named.filter((u): u is string => typeof u === "string" && PR_LINK.test(u)) : [];
    return links.length > MAX_PRS_PER_CALL ? [] : links;
}

// A PR has one owner, the last session that touched it: claiming takes it from every other one.
function claim(sessions: Map<string, Session>, ownerId: string, links: string[]): Map<string, Session> {
    if (!links.length) return sessions;
    const out = new Map(sessions);
    for (const [id, s] of sessions) {
        if (id === ownerId) out.set(id, { ...s, prs: [...(s.prs ?? []).filter((u) => !links.includes(u)), ...links] });
        else if (s.prs?.some((u) => links.includes(u))) out.set(id, { ...s, prs: s.prs.filter((u) => !links.includes(u)) });
    }
    return out;
}

// `wintos pr <link>` from inside a session. undefined: no live session in that block.
export function claimPrs(sessions: Map<string, Session>, blockId: string, links: string[], sessionId?: string): Map<string, Session> | undefined {
    const live = liveIn(sessions, blockId, sessionId);
    return live ? claim(sessions, live.id, links) : undefined;
}
// The lane steps a gh pr command proves were reached, so they move even when the session forgets.
const PR_STEPS: Record<string, RegExp> = { create: /\bprs?\b/, ready: /^ready$/ };
function withPrStep(lane: Lane | undefined, verb: unknown): Lane | undefined {
    const step = typeof verb === "string" ? PR_STEPS[verb] : undefined;
    if (!lane || !step) return lane;
    const i = lane.steps.findIndex((s, i) => i > lane.at && step.test(s.replace(/^\?\s*/, "").toLowerCase()));
    if (i < 0) return lane;
    const { note: _note, todos: _todos, ...rest } = lane;
    return { ...rest, at: i };
}
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
    const { session_id: id, hook_event_name: name, cwd, prompt, prs, pr_verb } = ev.payload;
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
        turnEndedAt: name === "Stop" ? now : prev?.turnEndedAt,
        promptAt: name === "UserPromptSubmit" ? now : prev?.promptAt,
    };
    const resume = typeof ev.payload.resume === "string" ? ev.payload.resume : prev?.resume;
    if (resume) session.resume = resume;
    if (prev?.prs) session.prs = prev.prs;
    if (prev?.status) session.status = prev.status;
    const lane = name === "PostToolUse" ? withPrStep(prev?.lane, pr_verb) : prev?.lane;
    if (lane) session.lane = lane;
    const out = new Map(sessions);
    for (const s of leavingFor(sessions, ev)) out.delete(s.id);
    out.set(id, session);
    return name === "PostToolUse" ? claim(out, id, prLinks(prs)) : out;
}

// The sessions an event puts out of its block. A saved one goes when anything reports from the
// block. A pane runs one interactive Claude, and switching it to another session (/resume, a
// fork) ends nothing, so the one it ran goes when the pane's session starts or is prompted.
export function leavingFor(sessions: Map<string, Session>, ev: HookEvent): Session[] {
    const { session_id: id, hook_event_name: name, resume } = ev.payload;
    const switched = typeof resume === "string" && (name === "SessionStart" || name === "UserPromptSubmit");
    return [...sessions.values()].filter((s) => s.blockId === ev.blockId && s.id !== id && (s.restored || (switched && !!s.resume && s.state !== "ended")));
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

// `wintos wait` from inside a session (the turn's Stop parks), or the developer parking a turn
// that already ended (⌥⌘P).
export function parkSession(sessions: Map<string, Session>, blockId: string, reason: string, now: number, sessionId?: string): Map<string, Session> {
    const live = liveIn(sessions, blockId, sessionId);
    if (!live) return sessions;
    // A turn that already ended waiting on the developer parks now: they parked it from WintOS.
    if (live.state === "waiting") return new Map(sessions).set(live.id, { ...live, state: "parked", since: now, parkedOn: reason, parkPending: undefined, donePending: undefined, lastAt: now });
    return new Map(sessions).set(live.id, { ...live, parkedOn: reason, parkPending: true, donePending: undefined, lastAt: now });
}

// ⌘Z after a park: the turn is yours again.
export function unparkSession(sessions: Map<string, Session>, sessionId: string, now: number): Map<string, Session> {
    const s = sessions.get(sessionId);
    if (!s || (s.state !== "parked" && !s.parkPending)) return sessions;
    const { parkedOn: _on, parkPending: _pending, ...rest } = s;
    return new Map(sessions).set(s.id, s.state === "parked" ? { ...rest, state: "waiting", since: now, lastAt: now } : rest);
}

export function setStatus(sessions: Map<string, Session>, blockId: string, text: string, now: number, sessionId?: string): Map<string, Session> {
    const live = liveIn(sessions, blockId, sessionId);
    if (!live) return sessions;
    return new Map(sessions).set(live.id, { ...live, status: { text, at: now } });
}

export function setLane(sessions: Map<string, Session>, blockId: string, name: string, steps: string[], sessionId?: string): Map<string, Session> {
    const live = liveIn(sessions, blockId, sessionId);
    if (!live) return sessions;
    return new Map(sessions).set(live.id, { ...live, lane: { name, steps, at: 0 } });
}

// undefined: no such step in the session's lane, so the caller can say so.
export function setStep(sessions: Map<string, Session>, blockId: string, step: string, note?: string, sessionId?: string): Map<string, Session> | undefined {
    const live = liveIn(sessions, blockId, sessionId);
    if (!live?.lane) return undefined;
    const bare = (s: string) => s.replace(/^\?\s*/, "").toLowerCase();
    const want = bare(step);
    const names = live.lane.steps.map(bare);
    const at = names.indexOf(want) >= 0 ? names.indexOf(want) : names.findIndex((n) => n.startsWith(want));
    if (at < 0) return undefined;
    const { note: _old, todos, ...lane } = live.lane;
    const kept = at === live.lane.at && todos ? { todos } : {};
    return new Map(sessions).set(live.id, { ...live, lane: { ...lane, at, ...kept, ...(note ? { note } : {}) } });
}

// undefined: the session has no lane yet, so the caller can say so.
export function setTodo(sessions: Map<string, Session>, blockId: string, items: string[], sessionId?: string): Map<string, Session> | undefined {
    const live = liveIn(sessions, blockId, sessionId);
    if (!live?.lane) return undefined;
    return new Map(sessions).set(live.id, { ...live, lane: { ...live.lane, todos: items.map((text) => ({ text, done: false })) } });
}

// Matched like a step: by name in any case, else by its start. undefined: no such to-do.
export function tickTodo(sessions: Map<string, Session>, blockId: string, item: string, sessionId?: string): Map<string, Session> | undefined {
    const live = liveIn(sessions, blockId, sessionId);
    const todos = live?.lane?.todos;
    if (!live?.lane || !todos) return undefined;
    const want = item.toLowerCase();
    const names = todos.map((t) => t.text.toLowerCase());
    const i = names.indexOf(want) >= 0 ? names.indexOf(want) : names.findIndex((n) => n.startsWith(want));
    if (i < 0) return undefined;
    return new Map(sessions).set(live.id, { ...live, lane: { ...live.lane, todos: todos.map((t, k) => (k === i ? { ...t, done: true } : t)) } });
}

// `wintos done` from inside a session: the block's live session ends this turn done.
export function finishSession(sessions: Map<string, Session>, blockId: string, now: number, sessionId?: string): Map<string, Session> {
    const live = liveIn(sessions, blockId, sessionId);
    if (!live) return sessions;
    return new Map(sessions).set(live.id, { ...live, donePending: true, parkPending: undefined, lastAt: now });
}

// The sessions a pane runs, not ended: usually one; a fork Claude Code runs in the background
// shares its parent's pane. The one you last prompted first: that is the one you talk to there.
export const liveSessionsIn = (sessions: Iterable<Session>, blockId: string): Session[] =>
    [...sessions].filter((s) => s.blockId === blockId && s.state !== "ended").sort((a, b) => (b.promptAt ?? b.lastAt) - (a.promptAt ?? a.lastAt) || b.lastAt - a.lastAt);
export const liveSessionIn = (sessions: Iterable<Session>, blockId: string): Session | undefined => liveSessionsIn(sessions, blockId)[0];
// The session a `wintos` call comes from: the one it names (CLAUDE_CODE_SESSION_ID), so a pane
// running several (a fork Claude Code runs in the background shares its pane) never mixes them
// up; without a name, the pane's.
const liveIn = (sessions: Map<string, Session>, blockId: string, sessionId?: string) => {
    const named = sessionId ? sessions.get(sessionId) : undefined;
    return named && named.state !== "ended" ? named : liveSessionIn(sessions.values(), blockId);
};
