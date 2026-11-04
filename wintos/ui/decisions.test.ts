import { describe, expect, test } from "vitest";
import type { Session } from "../daemon/sessions/reduce";
import { decisions, nextDecision } from "./decisions";
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

describe("decisions: turns", () => {
    test("each turn its own key, so a session that asks again comes back as a new card", () => {
        const [d] = decisions(state([s("a", { kind: "answer", text: "which?", by: "session" })]), NOW, title);
        expect(d.turn).toBe(`a:${NOW - 1000}`);
    });
    test("a turn whose Claude isn't started yet (saved at the last quit) is in the batch, marked so", () => {
        const [d] = decisions(state([s("a", { kind: "answer", text: "which?", by: "session" }, { restored: true })]), NOW, title);
        expect(d).toMatchObject({ sessionId: "a", restored: true });
        expect(decisions(state([s("a", { kind: "answer", by: "guess" })]), NOW, title)[0].restored).toBeUndefined();
    });
});

describe("nextDecision", () => {
    const list = decisions(state([s("a", { kind: "approve", by: "session" }), s("b", { kind: "decide", by: "session" })]), NOW, title);
    test("from outside the list, the first; from one of them, the next, round the end", () => {
        expect(nextDecision(list, undefined)?.sessionId).toBe("a");
        expect(nextDecision(list, "a")?.sessionId).toBe("b");
        expect(nextDecision(list, "b")?.sessionId).toBe("a");
    });
    test("nothing else waiting: none", () => {
        expect(nextDecision(list.slice(0, 1), "a")).toBeUndefined();
        expect(nextDecision([], undefined)).toBeUndefined();
    });
});
