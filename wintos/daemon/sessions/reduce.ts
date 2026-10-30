// kind "bg": sent from Claude's background service, not from the pane's own Claude.
export type HookPayload = { hook_event_name: string; session_id: string; cwd?: string; prompt?: string; prs?: unknown; pr_verb?: string; resume?: string; reason?: string; last_assistant_message?: string; tool_name?: string; kind?: string; agent_id?: string };
export type HookEvent = { tabId: string; blockId: string; payload: HookPayload };
// parked: the turn ended waiting on something outside (CI, a review), not on the developer.
// done: the turn ended with the goal met and nothing asked of the developer.
export type SessionState = "idle" | "working" | "waiting" | "parked" | "done" | "ended";
// What a turn waiting on the developer expects of them, at a glance. by: who said so: the
// question tool, the session itself (`wintos ask`), or a reading of its last message.
export const ASK_KINDS = ["answer", "decide", "approve", "unblock"] as const;
export type AskKind = (typeof ASK_KINDS)[number];
export type Ask = { kind: AskKind; text?: string; by: "tool" | "session" | "model" | "guess" };
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
    ask?: Ask; // what a waiting turn expects of the developer; none yet while it is being read
    askPending?: Ask; // `wintos ask` ran this turn; the turn's Stop asks it
    restored?: boolean; // saved at the last quit, its Claude not started again yet
    prs?: string[]; // the PRs it owns: it was the first to touch them (daemon/prs/owners.ts)
    touched?: string[]; // PRs it worked on that another session owns: it is "also in" them
    status?: { text: string; at: number }; // its own line on what it is doing (`wintos status`)
    name?: SessionName;
    lane?: Lane; // the process it follows and where it is in it (`wintos lane`, `wintos step`)
    turnEndedAt?: number; // the last Stop: a reply the developer may not have read yet
    outcome?: { text: string; at: number }; // how the last turn with text ended: its first line of prose
    promptAt?: number; // the last prompt: in a pane running two sessions, the one you talk to
    resume?: string; // the pane's resume command for it: only the session the pane runs sends one
    background?: boolean; // runs only in Claude's background service: no pane shows it
    attachedTo?: string; // a pane showing it (`claude attach`) while it runs in the background service
    subagents?: Record<string, number>; // the subagents it started that have not stopped, by id: when each started
};

// The subagents a session still runs. One whose stop never came (its Claude was killed) would
// count for good: past SUBAGENT_MAX_MS it no longer does.
export const SUBAGENT_MAX_MS = 3 * 3_600_000;
export const liveSubagents = (s: Session, now: number) => (s.state === "ended" ? 0 : Object.values(s.subagents ?? {}).filter((at) => now - at < SUBAGENT_MAX_MS).length);

// A step starting with ? is the developer's call: the session stops there.
// todos: what is in flight in the step now (`wintos todo`); the next step starts without them.
export type Todo = { text: string; done: boolean };
export type Lane = { name: string; steps: string[]; at: number; note?: string; todos?: Todo[] };

const LABEL_MAX = 24;
// One gh pr command names a PR or two (a stack); more is a listing, which claims nothing.
const MAX_PRS_PER_CALL = 3;
const PR_LINK = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;

// The PR links a call names, if it names few enough to be about them.
export function prLinks(named: unknown): string[] {
    const links = Array.isArray(named) ? named.filter((u): u is string => typeof u === "string" && PR_LINK.test(u)) : [];
    return links.length > MAX_PRS_PER_CALL ? [] : links;
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
const OUTCOME_MAX = 200;
// The first line of a reply that says something: headings are skipped, markdown marks dropped.
function outcomeOf(reply: unknown): string | undefined {
    if (typeof reply !== "string") return undefined;
    const line = reply
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l && !l.startsWith("#") && !/^[-*_`]{3,}$/.test(l));
    const text = line?.replace(/^[>*+-]\s+|^\d+\.\s+/, "").replace(/[*_`]+/g, "").trim();
    return text ? text.slice(0, OUTCOME_MAX) : undefined;
}
// A first prompt that is a paste, an image or a bare link says nothing about the work.
const NO_LABEL = /^(\s*("""|<pasted_content|\[Image #)|\s*https?:\/\/\S+\s*$)/;
const labelOf = (raw?: string) => {
    const prompt = raw?.replace(/^\s*❯\s*/, "");
    if (!prompt || NO_LABEL.test(prompt)) return undefined;
    return prompt.length > LABEL_MAX ? `${prompt.slice(0, LABEL_MAX - 1).trimEnd()}…` : prompt;
};

// Only these events move a session. SubagentStop fires when a subagent finishes while the
// main loop keeps working, and Notification fires for attachments and permission prompts;
// cmux folded both into "needs input", which is what made its NEEDS YOU unreliable.
const TRANSITIONS: Record<string, SessionState> = {
    SessionStart: "idle",
    UserPromptSubmit: "working",
    Stop: "waiting",
    SessionEnd: "ended",
};

const ASKING_TOOLS: Record<string, AskKind> = { AskUserQuestion: "answer", ExitPlanMode: "approve" };

export function reduceSession(sessions: Map<string, Session>, ev: HookEvent, now: number): Map<string, Session> {
    const { session_id: id, hook_event_name: name, cwd, prompt, pr_verb } = ev.payload;
    const prev = sessions.get(id);
    // One session can run in a pane and in the background service at once (a fork resumed in a
    // pane): the pane's copy is the one you see, and the background copy's events would move it
    // back to the pane its service was started from.
    const background = ev.payload.kind === "bg";
    if (background && prev && !prev.background && !prev.attachedTo && prev.state !== "ended") return sessions;
    // A resumed session starting up is still where it was at quit (a turn waiting on you). Quitting
    // WintOS ends every Claude with reason "other": that ends nothing, so the restart finds the
    // session with its PRs, lane and status. A pane WintOS closes ends its session itself (endSessions).
    const quits = name === "SessionEnd" && ev.payload.reason === "other";
    // A question mid-turn ends no turn, so no Stop says so: its tool's start and end do.
    const tool = ASKING_TOOLS[ev.payload.tool_name ?? ""];
    const asks = tool ? (name === "PreToolUse" ? "waiting" : name === "PostToolUse" ? "working" : undefined) : undefined;
    const next = (prev?.restored && name === "SessionStart") || quits ? undefined : (asks ?? TRANSITIONS[name]);
    const parks = name === "Stop" && prev?.parkPending;
    const finishes = name === "Stop" && prev?.donePending;
    const state = parks ? "parked" : finishes ? "done" : (next ?? prev?.state ?? "idle");
    // A session a pane is attached to reports from the background service, with the id of the
    // pane that service was started from; the pane showing it wins until a pane runs it itself.
    const runsHere = typeof ev.payload.resume === "string" && !background;
    const pinned = prev?.attachedTo && !runsHere ? prev : undefined;
    const session: Session = {
        id,
        tabId: pinned ? pinned.tabId : ev.tabId,
        blockId: pinned ? pinned.blockId : ev.blockId,
        state,
        since: next && next !== prev?.state ? now : (prev?.since ?? now),
        lastAt: now,
        cwd: cwd ?? prev?.cwd,
        label: prev?.label ?? labelOf(typeof prompt === "string" ? prompt : undefined),
        // A parked mark lasts one turn: the next Stop or prompt decides afresh.
        parkedOn: parks ? prev.parkedOn : next ? undefined : prev?.parkedOn,
        parkPending: next ? undefined : prev?.parkPending,
        donePending: next ? undefined : prev?.donePending,
        askPending: next ? undefined : prev?.askPending,
        // A turn's ask lasts until the session moves on; a Stop with none is read by the daemon.
        ask: asks === "waiting" ? { kind: tool, by: "tool" } : name === "Stop" && !parks && !finishes ? prev?.askPending : next ? undefined : prev?.ask,
        turnEndedAt: name === "Stop" ? now : prev?.turnEndedAt,
        promptAt: name === "UserPromptSubmit" ? now : prev?.promptAt,
    };
    const resume = typeof ev.payload.resume === "string" ? ev.payload.resume : prev?.resume;
    if (resume) session.resume = resume;
    if (prev?.prs) session.prs = prev.prs;
    if (prev?.touched) session.touched = prev.touched;
    if (prev?.status) session.status = prev.status;
    if (prev?.name) session.name = prev.name;
    const said = name === "Stop" ? outcomeOf(ev.payload.last_assistant_message) : undefined;
    const outcome = said ? { text: said, at: now } : prev?.outcome;
    if (outcome) session.outcome = outcome;
    const lane = name === "PostToolUse" ? withPrStep(prev?.lane, pr_verb) : prev?.lane;
    if (lane) session.lane = lane;
    if (background && !pinned) session.background = true;
    if (pinned) session.attachedTo = pinned.attachedTo;
    // A subagent runs until its own stop, which may come turns later (one sent to the background).
    const agent = ev.payload.agent_id;
    let subagents = name === "SessionEnd" ? undefined : prev?.subagents;
    if (agent && name === "SubagentStart") subagents = { ...subagents, [agent]: now };
    if (agent && name === "SubagentStop" && subagents) subagents = Object.fromEntries(Object.entries(subagents).filter(([a]) => a !== agent));
    if (subagents && Object.keys(subagents).length) session.subagents = subagents;
    const out = new Map(sessions);
    for (const s of leavingFor(sessions, ev)) out.delete(s.id);
    out.set(id, session);
    return out;
}

// The sessions an event puts out of its block. A saved one goes when anything reports from the
// block. A pane runs one interactive Claude, and switching it to another session (/resume, a
// fork) ends nothing, so the one it ran goes when the pane's session starts or is prompted.
// The never-prompted Claude a pane started with goes then too: it has nothing to resume.
export function leavingFor(sessions: Map<string, Session>, ev: HookEvent): Session[] {
    const { session_id: id, hook_event_name: name, resume } = ev.payload;
    if (ev.payload.kind === "bg") return [];
    const switched = typeof resume === "string" && (name === "SessionStart" || name === "UserPromptSubmit");
    return [...sessions.values()].filter(
        (s) => s.blockId === ev.blockId && s.id !== id && !s.background && (s.restored || (switched && s.state !== "ended" && (!!s.resume || !s.promptAt)))
    );
}

// The window saw a pane whose start command resumes this session: a `claude attach` to it, as it
// runs in the background service. It shows there from now on.
export function attachSession(sessions: Map<string, Session>, id: string, tabId: string, blockId: string): Map<string, Session> {
    const s = sessions.get(id);
    if (!s || s.state === "ended") return sessions;
    const { background: _bg, ...rest } = s;
    return new Map(sessions).set(id, { ...rest, tabId, blockId, attachedTo: blockId });
}

// ⌘W or ⇧⌘W: the panes are going, and the sessions in them with them.
export function endSessions(sessions: Map<string, Session>, ids: string[], now: number): Map<string, Session> {
    const out = new Map(sessions);
    for (const id of ids) {
        const s = sessions.get(id);
        if (s) out.set(id, { ...s, state: "ended", since: now, lastAt: now });
    }
    return out;
}

// Sessions saved at the last quit. The restart cut off any turn in progress; ended ones are gone,
// and, given the time, those not seen for two weeks: a pane closed outside WintOS left them behind.
const RESTORE_MAX_AGE_MS = 14 * 86_400_000;
export function restoreSessions(saved: Session[], now?: number): Map<string, Session> {
    const out = new Map<string, Session>();
    for (const s of saved) {
        if (s.state === "ended" || (now !== undefined && now - s.lastAt > RESTORE_MAX_AGE_MS)) continue;
        const { subagents: _gone, ...rest } = s;
        out.set(s.id, { ...rest, state: s.state === "working" ? "idle" : s.state, restored: true });
    }
    return out;
}

// `wintos wait` from inside a session (the turn's Stop parks), or the developer parking a turn
// that already ended (⌥⌘P).
export function parkSession(sessions: Map<string, Session>, blockId: string, reason: string, now: number, sessionId?: string): Map<string, Session> {
    const live = liveIn(sessions, blockId, sessionId);
    if (!live) return sessions;
    // A turn that already ended waiting on the developer parks now: they parked it from WintOS.
    if (live.state === "waiting") return new Map(sessions).set(live.id, { ...live, state: "parked", since: now, parkedOn: reason, parkPending: undefined, donePending: undefined, ask: undefined, lastAt: now });
    return new Map(sessions).set(live.id, { ...live, parkedOn: reason, parkPending: true, donePending: undefined, askPending: undefined, lastAt: now });
}

// ⌘Z after a park: the turn is yours again.
export function unparkSession(sessions: Map<string, Session>, sessionId: string, now: number): Map<string, Session> {
    const s = sessions.get(sessionId);
    if (!s || (s.state !== "parked" && !s.parkPending)) return sessions;
    const { parkedOn: _on, parkPending: _pending, ...rest } = s;
    return new Map(sessions).set(s.id, s.state === "parked" ? { ...rest, state: "waiting", since: now, lastAt: now } : rest);
}

// What the session is called everywhere. by: who named it. The session's own (`wintos name`)
// stands unless you rename it; yours sticks, and a later one of the session's is only
// suggested. A model's fills in where nobody named it.
export type SessionName = { text: string; by: "session" | "you" | "model"; at: number; suggested?: string };

export function nameSession(sessions: Map<string, Session>, blockId: string, text: string, now: number, sessionId?: string): Map<string, Session> {
    const live = liveIn(sessions, blockId, sessionId);
    if (!live) return sessions;
    const name: SessionName = live.name?.by === "you" ? { ...live.name, suggested: text } : { text, by: "session", at: now };
    return new Map(sessions).set(live.id, { ...live, name });
}

export function renameSession(sessions: Map<string, Session>, sessionId: string, text: string, now: number): Map<string, Session> {
    const s = sessions.get(sessionId);
    return s ? new Map(sessions).set(s.id, { ...s, name: { text, by: "you", at: now } }) : sessions;
}

export function acceptSuggestedName(sessions: Map<string, Session>, sessionId: string, now: number): Map<string, Session> {
    const suggested = sessions.get(sessionId)?.name?.suggested;
    return suggested ? renameSession(sessions, sessionId, suggested, now) : sessions;
}

export function titleSession(sessions: Map<string, Session>, sessionId: string, text: string, now: number): Map<string, Session> {
    const s = sessions.get(sessionId);
    if (!s || (s.name && s.name.by !== "model")) return sessions;
    return new Map(sessions).set(s.id, { ...s, name: { text, by: "model", at: now } });
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
    return new Map(sessions).set(live.id, { ...live, donePending: true, parkPending: undefined, askPending: undefined, lastAt: now });
}

// `wintos ask` from inside a session: the turn's Stop waits on the developer for this.
export function askSession(sessions: Map<string, Session>, blockId: string, kind: AskKind, text: string | undefined, now: number, sessionId?: string): Map<string, Session> {
    const live = liveIn(sessions, blockId, sessionId);
    if (!live) return sessions;
    return new Map(sessions).set(live.id, { ...live, askPending: { kind, ...(text ? { text } : {}), by: "session" }, parkPending: undefined, donePending: undefined, lastAt: now });
}

// What the daemon read in a turn that ended saying nothing (no ask, wait or done): an ask, or
// "done" for a reply that only reports. turnAt: the Stop it read; a later turn makes it moot.
export function readTurn(sessions: Map<string, Session>, sessionId: string, turnAt: number, read: Ask | "done"): Map<string, Session> {
    const s = sessions.get(sessionId);
    if (!s || s.state !== "waiting" || s.ask || s.turnEndedAt !== turnAt) return sessions;
    return new Map(sessions).set(s.id, read === "done" ? { ...s, state: "done" } : { ...s, ask: read });
}

// The sessions a pane runs, not ended: usually one. The one you last prompted first: that is the
// one you talk to there. A session only in the background service is in no pane, whichever pane
// its service was started from.
export const liveSessionsIn = (sessions: Iterable<Session>, blockId: string): Session[] =>
    [...sessions].filter((s) => s.blockId === blockId && s.state !== "ended" && !s.background).sort((a, b) => (b.promptAt ?? b.lastAt) - (a.promptAt ?? a.lastAt) || b.lastAt - a.lastAt);
export const liveSessionIn = (sessions: Iterable<Session>, blockId: string): Session | undefined => liveSessionsIn(sessions, blockId)[0];
// The session a `wintos` call comes from: the one it names (CLAUDE_CODE_SESSION_ID), so a pane
// running several (a fork Claude Code runs in the background shares its pane) never mixes them
// up; without a name, the pane's.
export const liveIn = (sessions: Map<string, Session>, blockId: string, sessionId?: string) => {
    const named = sessionId ? sessions.get(sessionId) : undefined;
    return named && named.state !== "ended" ? named : liveSessionIn(sessions.values(), blockId);
};
