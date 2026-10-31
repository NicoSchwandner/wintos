import type { PR } from "../daemon/prs/group";
import type { AskOption, AskPick, Session } from "../daemon/sessions/reduce";
import { shownState } from "./sessions";
import { sessionName, type WintosState } from "./view";

// One decision in the batch (⌥⌘O): a turn waiting on you, with the card its session gave (or the
// question tool's options, or what the daemon read from the turn), and the facts WintOS knows.
// turn: the session and when this turn began waiting; a session that asks again is a new card.
export type Decision = {
    sessionId: string;
    turn: string;
    blockId: string;
    tabId: string;
    project: string;
    session: string;
    kind: string;
    question: string;
    context?: string;
    why?: string;
    facts?: string;
    options: AskOption[];
    recommend?: number;
    picks?: AskPick[];
    final: boolean;
    by: string;
    since: number;
};

// Without a word from the session, these read as something that can't be undone.
const FINAL_WORDS = /\b(merge|deploy|release|delete|drop|force[- ]push|prod(uction)?|publish)\b/i;
const KIND_ORDER: Record<string, number> = { approve: 0, unblock: 1, answer: 1, decide: 2 };

const factsOf = (prs: PR[]): string | undefined => {
    const pr = prs[0];
    if (!pr) return undefined;
    const ci = pr.checks === "SUCCESS" ? "CI ✓" : pr.checks === "FAILURE" || pr.checks === "ERROR" ? "CI ✗" : pr.checks ? "CI running" : "";
    const review = pr.reviewDecision === "APPROVED" ? "approved" : pr.reviewDecision === "CHANGES_REQUESTED" ? "changes requested" : pr.isDraft ? "draft" : "in review";
    return [`#${pr.number}`, `+${pr.additions} −${pr.deletions}`, ci, review].filter(Boolean).join(" · ");
};

const leftForLater = (s: Session, state: WintosState, now: number) => {
    const l = state.rhythm?.later?.[s.id];
    return !!l && l.since === s.since && l.until > now;
};

// The turns waiting on you, quick ones first: approvals, then answers, then choices; what can't
// be undone last; the longest waiting first among equals.
export function decisions(state: WintosState, now: number, titleOf: (tabId: string) => string): Decision[] {
    const prs = (state.plugins?.["gh-prs"]?.data as { prs?: PR[] } | undefined)?.prs ?? [];
    const out = state.sessions
        .filter((s) => !s.background && !s.restored && shownState(s, now) === "waiting" && !leftForLater(s, state, now))
        .map((s): Decision => {
            // Not read yet (the daemon reads an ended turn a moment later): a plain turn of yours.
            const a = s.ask ?? { kind: "answer" as const, by: "guess" as const };
            const question = a.text ?? "Your turn";
            const facts = factsOf(prs.filter((p) => s.prs?.includes(p.url)));
            return {
                sessionId: s.id,
                turn: `${s.id}:${s.since}`,
                blockId: s.blockId,
                tabId: s.tabId,
                project: titleOf(s.tabId),
                session: sessionName(s),
                kind: a.kind,
                question,
                ...(a.context ? { context: a.context } : {}),
                ...(a.why ? { why: a.why } : {}),
                ...(facts ? { facts } : {}),
                options: a.options ?? [],
                ...(a.recommend ? { recommend: a.recommend } : {}),
                ...(a.picks?.length ? { picks: a.picks } : {}),
                final: a.final ?? (a.by !== "session" && FINAL_WORDS.test(question)),
                by: a.by,
                since: s.since,
            };
        });
    return out.sort((a, b) => Number(a.final) - Number(b.final) || (KIND_ORDER[a.kind] ?? 1) - (KIND_ORDER[b.kind] ?? 1) || a.since - b.since);
}

// What WintOS types into the session for an answer: an option by its label (the question tool
// takes its number), your call, or your own words; then which picks are in and which left out.
export function answerText(d: Decision, answer: { option: number } | { yourCall: true } | { own: string }, picked?: boolean[]): string {
    const text = answerOnly(d, answer);
    if (!text || !d.picks) return text;
    const list = (on: boolean) => d.picks!.filter((_, i) => (picked?.[i] ?? d.picks![i].on) === on).map((p) => p.label).join("; ");
    const [inc, out] = [list(true), list(false)];
    return [/[.!?]$/.test(text) ? text : `${text}.`, inc && `Include: ${inc}.`, out && `Leave out: ${out}.`].filter(Boolean).join(" ");
}

function answerOnly(d: Decision, answer: { option: number } | { yourCall: true } | { own: string }): string {
    if ("own" in answer) return answer.own.trim();
    if ("yourCall" in answer) return d.recommend ? `Go with your recommendation: ${d.options[d.recommend - 1]?.label}.` : "Go with what you recommend.";
    if (d.by === "tool") return String(answer.option);
    const o = d.options[answer.option - 1];
    return o ? `${o.label}.` : String(answer.option);
}
