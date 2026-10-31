import { describe, expect, test } from "vitest";
import type { Session } from "../daemon/sessions/reduce";
import { answerText, decisions } from "./decisions";
import type { WintosState } from "./view";

const NOW = 1_000_000;
const s = (id: string, ask: Session["ask"], o: Partial<Session> = {}): Session => ({ id, tabId: `t-${id}`, blockId: `b-${id}`, state: "waiting", since: NOW - 1000, lastAt: NOW, ask, ...o });
const state = (sessions: Session[], prs: object[] = []): WintosState => ({ now: NOW, projects: [], sessions, plugins: { "gh-prs": { ok: true, at: 0, data: { me: "me", prs } } } }) as unknown as WintosState;
const title = (t: string) => t.toUpperCase();

describe("decisions", () => {
    test("quick ones first: approvals, then answers, then choices, what can't be undone last", () => {
        const d = decisions(state([
            s("merge", { kind: "decide", text: "merge #3?", by: "model" }),
            s("pick", { kind: "decide", text: "two bands or one", by: "session" }),
            s("ok", { kind: "approve", text: "go with the plan", by: "session" }),
            s("q", { kind: "answer", text: "which account?", by: "guess" }),
        ]), NOW, title);
        expect(d.map((x) => [x.sessionId, x.final])).toEqual([["ok", false], ["q", false], ["pick", false], ["merge", true]]);
    });

    test("the session's card as given, its PR's facts, and only turns that wait on you", () => {
        const pr = { url: "u1", number: 7, additions: 12, deletions: 3, checks: "SUCCESS", reviewDecision: "APPROVED", isDraft: false };
        const card = { kind: "decide" as const, text: "merge or hold?", by: "session" as const, context: "routes documents", why: "CI green", options: [{ label: "Merge" }, { label: "Hold" }], recommend: 1, final: true };
        const d = decisions(state([s("a", card, { prs: ["u1"] }), s("busy", { kind: "answer", by: "guess" }, { state: "working" })], [pr]), NOW, title);
        expect(d).toEqual([expect.objectContaining({ sessionId: "a", project: "T-A", context: "routes documents", why: "CI green", facts: "#7 · +12 −3 · CI ✓ · approved", options: card.options, recommend: 1, final: true })]);
    });
});

describe("decisions: turns, and the ones left for later", () => {
    test("each turn its own key, so a session that asks again comes back as a new card", () => {
        const [d] = decisions(state([s("a", { kind: "answer", text: "which?", by: "session" })]), NOW, title);
        expect(d.turn).toBe(`a:${NOW - 1000}`);
    });
    test("a turn left for the next batch stays out until then; its session's next turn does not", () => {
        const st = (since: number) => ({ ...state([s("a", { kind: "answer", by: "guess" }, { since })]), rhythm: { later: { a: { since: NOW - 1000, until: NOW + 1 } } } }) as unknown as WintosState;
        expect(decisions(st(NOW - 1000), NOW, title)).toEqual([]);
        expect(decisions(st(NOW - 500), NOW, title)).toHaveLength(1);
        expect(decisions(st(NOW - 1000), NOW + 1, title)).toHaveLength(1);
    });
});

describe("answerText", () => {
    const d = decisions(state([s("a", { kind: "decide", text: "merge or hold?", by: "session", options: [{ label: "Merge now", then: "live Monday" }, { label: "Hold" }], recommend: 1 })]), NOW, title)[0];
    test.each([
        [{ option: 2 }, "Hold."],
        [{ yourCall: true as const }, "Go with your recommendation: Merge now."],
        [{ own: "  per endpoint, not global " }, "per endpoint, not global"],
    ])("%j → %s", (a, text) => expect(answerText(d, a)).toBe(text));
    test("picks: what is on and what is left out, after the answer", () => {
        const r = decisions(state([s("r", { kind: "approve", text: "approve #7?", by: "session", options: [{ label: "Approve" }, { label: "Request changes" }], picks: [{ label: "Missing test", on: true }, { label: "Rename it", on: false }] })]), NOW, title)[0];
        expect(answerText(r, { option: 1 }, [true, false])).toBe("Approve. Include: Missing test. Leave out: Rename it.");
        expect(answerText(r, { own: "approve, but ask about the cache" }, [false, false])).toBe("approve, but ask about the cache. Leave out: Missing test; Rename it.");
    });
    test("the question tool takes the option's number", () => expect(answerText({ ...d, by: "tool" }, { option: 2 })).toBe("2"));
});
