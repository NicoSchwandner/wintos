// A session's next step, held until something happens to a PR: when it does, WintOS types the
// prompt into the session's pane. A fixed set of events, so every wake reads the same way and
// none needs a script of its own.
// rereview: you (or your team) are asked to review again; comments: someone reviewed or
// commented on it since the wake was set.
export const WAKE_EVENTS = ["green", "merged", "released", "rereview", "comments"] as const;
export type WakeEvent = (typeof WAKE_EVENTS)[number];
export const isWakeEvent = (e: unknown): e is WakeEvent => (WAKE_EVENTS as readonly unknown[]).includes(e);

// due: when the event was seen; it is typed once the session's pane is live and between turns.
// lines: for a re-review, the lines of logic changed since your review.
export type Wake = { sessionId: string; pr: string; until: WakeEvent; prompt: string; at: number; expires: number; due?: number; lines?: number };
// One per session: a session that sets a second one has changed its mind.
export type Wakes = Record<string, Wake>;

// What a PR's state is now, as far as the events go. checks: its last commit's CI.
// requestedAgain: you or your team are requested and you reviewed it before; logicLines: what
// changed since your last review, tests and generated files left out; feedbackAt: the latest
// review or comment by a person other than you.
export type PrNow = { state: "OPEN" | "MERGED" | "CLOSED"; checks: "green" | "red" | "pending" | "none"; released: boolean; requestedAgain?: boolean; logicLines?: number; feedbackAt?: number };

const WORKING_DAYS_KEPT = 5;
export const MAX_PROMPT = 1000;
// More changed than this since your review, and the re-review is yours to look at, not the session's.
export const REREVIEW_MAX_LINES = 50;

// Changes that are no business logic: tests, generated code, lock files and dependency
// manifests, project files, docs, and the tooling in a repo's root dot-folders (.github, .claude).
const NOT_LOGIC = [
    /^\.[^/]+\//,
    /(^|\/)(tests?|__tests__|specs?|[\w.]*Tests?)\//i,
    /\.(test|spec)\.\w+$/,
    /Tests?\.cs$/,
    /(^|\/)Migrations\//,
    /ModelSnapshot\.cs$/,
    /\.(g|g\.i|designer|generated)\.\w+$/i,
    /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|packages\.lock\.json|package\.json)$/,
    /\.(csproj|sln|props|targets)$/,
    /\.(snap|md)$/,
    /\.(verified|received)\.\w+$/,
];
export const isLogic = (path: string) => !NOT_LOGIC.some((re) => re.test(path));

// since: when the wake was set; feedback before it was already there.
export function reached(until: WakeEvent, pr: PrNow, since: number): boolean {
    if (until === "green") return pr.checks === "green";
    if (until === "merged") return pr.state === "MERGED";
    if (until === "released") return pr.released;
    if (pr.state !== "OPEN") return false;
    return until === "rereview" ? !!pr.requestedAgain : (pr.feedbackAt ?? 0) > since;
}

// A closed PR never gets there, nor a merged one to a review; a red one can still turn green.
export const unreachable = (until: WakeEvent, pr: PrNow) =>
    pr.state === "CLOSED" || (pr.state === "MERGED" && (until === "green" ? pr.checks !== "green" : until === "rereview" || until === "comments"));

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
const WAITING: Record<WakeEvent, string> = { green: "to go green", merged: "to be merged", released: "to be released", rereview: "to ask for a re-review", comments: "to get review feedback" };
const WHEN: Record<WakeEvent, string> = { green: "goes green", merged: "is merged", released: "is released", rereview: "asks for a re-review", comments: "gets review feedback" };
export const waitingOn = (w: Pick<Wake, "pr" | "until">) => `${refOf(w.pr)} ${WAITING[w.until]}`;
// ref: how the window names the PR (its repo's short name), else owner/repo#n.
export const wakesWhen = (w: Pick<Wake, "pr" | "until">, ref = refOf(w.pr)) => `wakes when ${ref} ${WHEN[w.until]}`;
// A re-review past the line limit is the developer's: the session asks instead. Feedback is
// triaged: small fixes it makes, a comment on the approach goes to the developer.
export function wakePrompt(w: Wake): string {
    const ref = refOf(w.pr);
    // Not knowing how much changed counts as too much.
    if (w.until === "rereview" && (w.lines === undefined || w.lines > REREVIEW_MAX_LINES)) {
        const how = w.lines === undefined ? "an unknown amount of logic" : `${w.lines} lines of logic`;
        return `[WintOS wake: ${ref} asks for your review again, and ${how} changed since your review, more than the ${REREVIEW_MAX_LINES} lines you may re-review on your own] Don't re-review it. Run \`wintos ask approve "re-review ${ref}: ${how} changed"\` and stop.`;
    }
    if (w.until === "rereview") return `[WintOS wake: ${ref} asks for your review again; ${w.lines} lines of logic changed since your review] ${w.prompt}`;
    if (w.until === "comments")
        return `[WintOS wake: ${ref} has new review feedback] ${w.prompt} Triage each comment first: fix the small ones; when one questions the approach or asks for a bigger change, don't change course on your own: run \`wintos ask decide "<the comment, a few words>"\` and stop.`;
    return `[WintOS wake: ${ref} is ${w.until === "green" ? "green" : w.until}] ${w.prompt}`;
}
const refOf = (url: string) => url.replace(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+).*$/, "$1#$2");

// The wakes after a check of their PRs: due ones marked, unreachable and expired ones dropped.
export function afterCheck(wakes: Wakes, now: number, prs: Record<string, PrNow | undefined>): { wakes: Wakes; dropped: Wake[] } {
    const out: Wakes = {};
    const dropped: Wake[] = [];
    for (const [id, w] of Object.entries(wakes)) {
        const pr = prs[w.pr];
        if (w.due) out[id] = w;
        else if (pr && reached(w.until, pr, w.at)) out[id] = { ...w, due: now, ...(w.until === "rereview" && pr.logicLines !== undefined ? { lines: pr.logicLines } : {}) };
        else if (now > w.expires || (pr && unreachable(w.until, pr))) dropped.push(w);
        else out[id] = w;
    }
    return { wakes: out, dropped };
}
