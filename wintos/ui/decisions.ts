import type { PR } from "../daemon/prs/group";
import type { AskOption, AskPick, Session } from "../daemon/sessions/reduce";
import { shownState } from "./sessions";
import { sessionName, type WintosState } from "./view";

// A turn waiting on you, in the order ⌥⌘O walks them, with what its session (or the daemon's
// reading of the turn) says it needs.
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
    restored?: true; // saved at the last quit: its Claude starts when answered
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

// The turns waiting on you, quick ones first: approvals, then answers, then choices; what can't
// be undone last; the longest waiting first among equals.
export function decisions(state: WintosState, now: number, titleOf: (tabId: string) => string): Decision[] {
    const prs = (state.plugins?.["gh-prs"]?.data as { prs?: PR[] } | undefined)?.prs ?? [];
    const out = state.sessions
        .filter((s) => !s.background && shownState(s, now) === "waiting")
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
                ...(s.restored ? { restored: true as const } : {}),
            };
        });
    // A driving project's turns come first: those projects are the day's work.
    const drives = (d: Decision) => Number(!state.driving?.includes(d.tabId));
    return out.sort((a, b) => drives(a) - drives(b) || Number(a.final) - Number(b.final) || (KIND_ORDER[a.kind] ?? 1) - (KIND_ORDER[b.kind] ?? 1) || a.since - b.since);
}

// ⌥⌘O: the next turn waiting on you, after the one you are in, round the list; none when the one
// you are in is the only one.
export function nextDecision(list: Decision[], currentSessionId: string | undefined): Decision | undefined {
    const at = list.findIndex((d) => d.sessionId === currentSessionId);
    const next = list[(at + 1) % (list.length || 1)];
    return next && next.sessionId !== currentSessionId ? next : undefined;
}
