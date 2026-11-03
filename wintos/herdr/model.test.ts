import { describe, expect, test } from "vitest";
import type { Session } from "../daemon/sessions/reduce";
import type { WintosState } from "../ui/view";
import { deliveries, prGo, prPage, sidebar } from "./model";

const NOW = 1_000_000;
const s = (id: string, tabId: string, o: Partial<Session>) => ({ id, tabId, blockId: `t-${id}`, since: NOW - 10, lastAt: NOW - 10, ...o }) as Session;
const projects = ["a", "b", "c"].map((id) => ({ id, title: id.toUpperCase(), dir: `/${id}`, mtime: 0 }) as never);

describe("the Herdr sidebar", () => {
    const state = { now: NOW, projects, driving: ["c"], sessions: [s("1", "a", { state: "waiting" }), s("2", "b", { state: "working" }), s("3", "c", { state: "waiting", since: NOW - 50 }), s("4", "c", { state: "working" })] } as WintosState;
    const m = sidebar(state, ["a", "b", "c"], {}, NOW);
    test("driving first, then the bands, each row with its view and where a click lands", () => {
        expect([m.driving.map((d) => d.tabId), m.needs.map((r) => [r.tabId, r.view.title, r.target?.blockId]), m.running.map((r) => r.tabId)]).toEqual([["c"], [["a", "A", "t-1"]], ["b"]]);
    });
    test("agent.next goes to what waits in the driving projects, then to Your move; nothing running", () => {
        expect(m.order).toEqual(["t-3", "t-1"]);
    });
});

describe("wakes in Herdr", () => {
    test("each tab's due wake for its idle session, typed into its terminal", () => {
        const wakes = { w: { sessionId: "1", pr: "https://github.com/o/r/pull/7", until: "merged", prompt: "go on", due: NOW } } as never;
        const state = { now: NOW, projects, wakes, sessions: [s("1", "a", { state: "idle" })] } as WintosState;
        expect(deliveries(state, ["a", "b"]).map((d) => [d.kind, d.tabId, "blockId" in d && d.blockId])).toEqual([["type", "a", "t-1"]]);
    });
});

describe("o on a PR: back to the session that made it", () => {
    const url = "https://github.com/o/r/pull/7";
    const pr = { url, repo: "o/r", number: 7, title: "Fix it", author: "me", isDraft: false, createdAt: "2026-11-01T09:00:00Z", conflict: false, requestedMe: false, requestedTeam: false, reviewedByMe: false, reviewers: [], additions: 1, deletions: 1, branch: "b" };
    const base = (o: object) => ({ now: NOW, projects, sessions: [], plugins: { "gh-prs": { ok: true, at: 0, data: { me: "me", prs: [pr] } } }, ...o }) as unknown as WintosState;
    test("its session still runs: that terminal", () => {
        expect(prGo(base({ sessions: [s("1", "a", { state: "idle", prs: [url] })] }), ["a"], url)).toEqual({ kind: "terminal", tabId: "a", terminal: "t-1" });
    });
    test("its session was closed: resumed, in its project's tab or a new one", () => {
        const shelf = { a: [{ sessionId: "1", script: "cd '/x' && claude --resume '1'", label: "l", prs: [url], at: 0 }] };
        expect(prGo(base({ shelf }), ["a"], url)).toEqual({ kind: "resume", tabId: "a", script: "cd '/x' && claude --resume '1'", open: true });
        expect(prGo(base({ shelf }), [], url)).toMatchObject({ kind: "resume", open: false });
    });
    test("no project knows it: a new one", () => expect(prGo(base({}), ["a"], url)).toEqual({ kind: "new", url }));
    test("a PR assigned to you is yours to drive, its author named", () => {
        const page = prPage({ ...base({}), plugins: { "gh-prs": { ok: true, at: 0, data: { me: "me", prs: [{ ...pr, author: "ana", assignedMe: true }] } } } } as unknown as WintosState, [], NOW)!;
        expect(page.groups.flatMap((g) => g.rows.map((r) => [g.label, r.author]))).toEqual([["Waiting", "ana → you"]]);
    });
    test("the page groups it and names its session", () => {
        const page = prPage(base({ sessions: [s("1", "a", { state: "idle", prs: [url], name: { text: "fix it", by: "session", at: 0 } })] }), ["a"], NOW)!;
        expect(page.groups.flatMap((g) => g.rows.map((r) => [g.label, r.number, r.owner, r.live]))).toEqual([["Waiting", 7, "fix it", true]]);
    });
});
