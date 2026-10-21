// A session's next step, held until something happens to a PR: when it does, WintOS types the
// prompt into the session's pane. A fixed set of events, so every wake reads the same way and
// none needs a script of its own.
export const WAKE_EVENTS = ["green", "merged", "released"] as const;
export type WakeEvent = (typeof WAKE_EVENTS)[number];
export const isWakeEvent = (e: unknown): e is WakeEvent => (WAKE_EVENTS as readonly unknown[]).includes(e);

// due: when the event was seen; it is typed once the session's pane is live and between turns.
export type Wake = { sessionId: string; pr: string; until: WakeEvent; prompt: string; at: number; expires: number; due?: number };
// One per session: a session that sets a second one has changed its mind.
export type Wakes = Record<string, Wake>;

// What a PR's state is now, as far as the events go. checks: its last commit's CI.
export type PrNow = { state: "OPEN" | "MERGED" | "CLOSED"; checks: "green" | "red" | "pending" | "none"; released: boolean };

const WORKING_DAYS_KEPT = 5;
export const MAX_PROMPT = 1000;

export function reached(until: WakeEvent, pr: PrNow): boolean {
    if (until === "green") return pr.checks === "green";
    if (until === "merged") return pr.state === "MERGED";
    return pr.released;
}

// A closed PR never gets there; a red one can still turn green.
export const unreachable = (until: WakeEvent, pr: PrNow) => pr.state === "CLOSED" || (until === "green" && pr.state === "MERGED" && pr.checks !== "green");

type Check = { status?: string; conclusion?: string; state?: string };
const OK = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const BAD = new Set(["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"]);
// gh's statusCheckRollup: check runs carry status and conclusion, commit statuses a state.
export function rollup(checks: Check[]): PrNow["checks"] {
    if (!checks.length) return "none";
    const results = checks.map((c) => (c.status && c.status !== "COMPLETED" ? "PENDING" : (c.conclusion || c.state || "PENDING").toUpperCase()));
    if (results.some((r) => BAD.has(r))) return "red";
    return results.every((r) => OK.has(r)) ? "green" : "pending";
}

export function expiresAt(now: number): number {
    const d = new Date(now);
    for (let left = WORKING_DAYS_KEPT; left > 0; ) {
        d.setDate(d.getDate() + 1);
        if (d.getDay() !== 0 && d.getDay() !== 6) left--;
    }
    return d.getTime();
}

// What a pane is shown while it waits, and what the session is told when it wakes.
export const waitingOn = (w: Pick<Wake, "pr" | "until">) => `${refOf(w.pr)} ${w.until === "green" ? "to go green" : `to be ${w.until}`}`;
export const wakePrompt = (w: Wake) => `[WintOS wake: ${refOf(w.pr)} is ${w.until === "green" ? "green" : w.until}] ${w.prompt}`;
const refOf = (url: string) => url.replace(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+).*$/, "$1#$2");

// The wakes after a check of their PRs: due ones marked, unreachable and expired ones dropped.
export function afterCheck(wakes: Wakes, now: number, prs: Record<string, PrNow | undefined>): { wakes: Wakes; dropped: Wake[] } {
    const out: Wakes = {};
    const dropped: Wake[] = [];
    for (const [id, w] of Object.entries(wakes)) {
        const pr = prs[w.pr];
        if (w.due) out[id] = w;
        else if (pr && reached(w.until, pr)) out[id] = { ...w, due: now };
        else if (now > w.expires || (pr && unreachable(w.until, pr))) dropped.push(w);
        else out[id] = w;
    }
    return { wakes: out, dropped };
}
