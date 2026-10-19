import { describe, expect, test } from "vitest";
import type { Row } from "../daemon/ranking/rank";
import { inboxKind, inboxTabId, isInboxTab, prProjectLists, prProjects, projectSessions, projectTabIds, projectPrList, projectTouched, relTime, sessionHeader, sessionTouched, urgentPr, type WintosState } from "./view";

const NOW = 1_000_000_000;
const row = (band: Row["band"], extra: Partial<Row> = {}): Row => ({ tabId: "t", band, lastAt: NOW - 60_000, sessions: [], ...extra });

describe("relTime", () => {
    test.each([
        [40_000, "40s"],
        [6 * 60_000, "6m"],
        [19 * 3_600_000, "19h"],
        [4 * 86_400_000, "4d"],
        [-5, "0s"],
    ])("%i ms → %s", (ms, out) => expect(relTime(ms)).toBe(out));
});

describe("the Inbox tab", () => {
    const tab = (meta: Record<string, unknown>) => ({ meta, blockids: [] }) as unknown as Tab;
    const tabs = { p1: tab({}), ib: tab({ "wintos:inbox": true }), p2: tab({}) };

    test("is recognised by its meta, and a tab not loaded yet is a project", () => {
        expect(isInboxTab(tabs.ib)).toBe(true);
        expect(isInboxTab(tabs.p1)).toBe(false);
        expect(isInboxTab(undefined)).toBe(false);
    });

    test("never counts as a project", () => expect(projectTabIds(["p1", "ib", "p2"], tabs)).toEqual(["p1", "p2"]));

    test("an old blank placeholder tab is not a project either", () =>
        expect(projectTabIds(["p1", "old", "used"], { ...tabs, old: { meta: { "wintos:blank": true } } as unknown as Tab, used: { meta: { "wintos:blank": true }, blockids: ["b1"] } as unknown as Tab })).toEqual(["p1", "used"]));

    test("is found among the tabs, or not at all", () => {
        expect(inboxTabId(["p1", "ib"], tabs, "prs")).toBe("ib");
        expect(inboxTabId(["p1"], tabs, "prs")).toBeUndefined();
    });

    test("PRs and On call are two tabs, each found by its list; an Inbox from before the split is the PRs one", () => {
        const two = { ...tabs, oc: tab({ "wintos:inbox": "oncall" }), pr: tab({ "wintos:inbox": "prs" }) };
        expect(inboxKind(two.oc)).toBe("oncall");
        expect(inboxKind(two.pr)).toBe("prs");
        expect(inboxKind(two.ib)).toBe("prs");
        expect(inboxKind(two.p1)).toBeUndefined();
        expect(inboxTabId(["p1", "oc", "pr"], two, "oncall")).toBe("oc");
        expect(projectTabIds(["p1", "oc", "pr"], two)).toEqual(["p1"]);
    });
});

describe("projectPrList (the notes' Pull requests section)", () => {
    const base = { repo: "acme/api", title: "t", author: "me", isDraft: false, conflict: false, requestedMe: false, requestedTeam: false, reviewedByMe: false, reviewers: [], additions: 1, deletions: 1 };
    const p = (n: number, extra: object = {}) => ({ ...base, number: n, url: `https://github.com/acme/api/pull/${n}`, branch: `b${n}`, createdAt: "2026-09-25T08:00:00Z", ...extra });
    const st = (prs: object[], snoozes = {}) =>
        ({ now: Date.parse("2026-09-28T09:00:00Z"), sessions: [], projects: [{ id: "t1", title: "x", titleLocked: false, pr: ["acme/api#1", "acme/api#2", "acme/api#3"], dir: "/d", mtime: 0 }], plugins: { "gh-prs": { ok: true, at: 0, data: { me: "me", prs } } }, snoozes }) as unknown as WintosState;

    test("a PR a shelved session owns is on its shelf row, not here", () => {
        const state = { ...st([p(1), p(2)]), shelf: { t1: [{ sessionId: "z", script: "s", label: "l", at: 0, prs: ["https://github.com/acme/api/pull/2"] }] } } as WintosState;
        expect(projectPrList(state, "t1").map((r) => r.pr.number)).toEqual([1]);
    });

    test("the project's PRs, most urgent group first, with what each one waits on", () => {
        const list = projectPrList(st([p(1, { reviewers: ["ana"] }), p(2, { checks: "FAILURE" }), p(3, { reviewDecision: "APPROVED", checks: "SUCCESS" })]), "t1");
        expect(list.map((r) => [r.pr.number, r.group, r.note])).toEqual([
            [3, "merge", undefined],
            [2, "fix", "CI red"],
            [1, "waiting", "waiting on ana"],
        ]);
    });

    test("a snoozed one stays listed, marked, at the end; a stacked one names its base", () => {
        const one = p(1, { reviewers: ["ana"] });
        const two = p(2, { base: "b1", defaultBranch: "main", stackedOn: one.url, reviewDecision: "APPROVED", checks: "SUCCESS" });
        const list = projectPrList(st([one, two], { [one.url]: { until: Date.parse("2026-09-29T00:00:00Z"), movedAt: one.createdAt } }), "t1");
        expect(list.map((r) => [r.pr.number, r.snoozed, r.note])).toEqual([
            [2, false, "stacked on #1"],
            [1, true, "waiting on ana"],
        ]);
    });

    test("a PR a session in this project owns is on its pane, not in the list", () => {
        const owner = { id: "s", tabId: "t1", blockId: "b", state: "working", since: 0, lastAt: 0, prs: ["https://github.com/acme/api/pull/2"] };
        const list = projectPrList({ ...st([p(1), p(2)]), sessions: [owner] } as unknown as WintosState, "t1");
        expect(list.map((r) => r.pr.number)).toEqual([1]);
    });

    test("no PR data yet, or no project, is an empty list", () => {
        expect(projectPrList({ now: 0, sessions: [], projects: [] } as unknown as WintosState, "t1")).toEqual([]);
    });
});

describe("prProjects", () => {
    test("which project each PR belongs to, snoozed PRs included", () => {
        const pr = { repo: "acme/api", number: 5, url: "https://github.com/acme/api/pull/5", title: "t", author: "me", isDraft: false, createdAt: "2026-09-28T08:00:00Z", conflict: false, requestedMe: false, requestedTeam: false, reviewedByMe: false, reviewers: [], additions: 1, deletions: 1, branch: "b" };
        const other = { ...pr, number: 6, url: "https://github.com/acme/api/pull/6" };
        const state = { now: 0, sessions: [], projects: [{ id: "t1", title: "X", titleLocked: false, pr: ["acme/api#5"], dir: "/d", mtime: 0 }], plugins: { "gh-prs": { ok: true, at: 0, data: { me: "me", prs: [pr, other] } } }, snoozes: { [pr.url]: { until: 1e15, movedAt: pr.createdAt } } } as unknown as WintosState;
        expect([...prProjects(["t1"], state)]).toEqual([[pr.url, "t1"]]);
    });

    test("a closed project keeps its PRs, through its shelf; it leads for a PR its session owns, an open one naming it too is also in", () => {
        const pr = { repo: "acme/api", number: 5, url: "https://github.com/acme/api/pull/5", title: "t", author: "me", isDraft: false, createdAt: "2026-09-28T08:00:00Z", conflict: false, requestedMe: false, requestedTeam: false, reviewedByMe: false, reviewers: [], additions: 1, deletions: 1, branch: "b" };
        const other = { ...pr, number: 6, url: "https://github.com/acme/api/pull/6" };
        const shelved = (url: string) => [{ sessionId: "s", script: "x", label: "l", at: 0, prs: [url] }];
        const state = {
            now: 0, sessions: [],
            projects: [{ id: "open", title: "O", titleLocked: false, pr: ["acme/api#6"], dir: "/o", mtime: 0 }, { id: "closed", title: "C", titleLocked: false, dir: "/c", mtime: 0 }],
            shelf: { closed: [...shelved(pr.url), ...shelved(other.url)] },
            plugins: { "gh-prs": { ok: true, at: 0, data: { me: "me", prs: [pr, other] } } },
        } as unknown as WintosState;
        expect(Object.fromEntries(prProjects(["open"], state))).toEqual({ [pr.url]: "closed", [other.url]: "closed" });
        expect(prProjectLists(["open"], state).get(other.url)).toEqual(["closed", "open"]);
    });
});

describe("prProjectLists (a PR in several projects)", () => {
    test("the owner's project first, then every project a session also worked on it in", () => {
        const pr = { repo: "acme/api", number: 5, url: "https://github.com/acme/api/pull/5", title: "t", author: "me", isDraft: false, createdAt: "2026-09-28T08:00:00Z", conflict: false, requestedMe: false, requestedTeam: false, reviewedByMe: false, reviewers: [], additions: 1, deletions: 1, branch: "b" };
        const state = {
            now: 0,
            projects: [{ id: "fixer", title: "F", titleLocked: false, dir: "/f", mtime: 0 }, { id: "receipt", title: "R", titleLocked: false, dir: "/r", mtime: 0 }],
            sessions: [{ id: "x", tabId: "fixer", blockId: "b", state: "waiting", since: 0, lastAt: 0, touched: [pr.url] }],
            shelf: { receipt: [{ sessionId: "owner", script: "s", label: "l", at: 0, prs: [pr.url] }] },
            plugins: { "gh-prs": { ok: true, at: 0, data: { me: "me", prs: [pr] } } },
        } as unknown as WintosState;
        expect(prProjectLists(["fixer", "receipt"], state).get(pr.url)).toEqual(["receipt", "fixer"]);
        expect(prProjects(["fixer", "receipt"], state).get(pr.url)).toBe("receipt");
    });
});

describe("sessionHeader (the header on a Claude pane)", () => {
    const base = { repo: "acme/api", title: "t", author: "me", isDraft: false, conflict: false, requestedMe: false, requestedTeam: false, reviewedByMe: false, reviewers: [], additions: 1, deletions: 1, createdAt: "2026-09-21T08:00:00Z" };
    const p = (n: number, extra: object = {}) => ({ ...base, number: n, url: `https://github.com/acme/api/pull/${n}`, branch: `DEV-77-thing`, ...extra });
    const sess = (extra: object = {}) => ({ id: "s", tabId: "t1", blockId: "b", state: "working", since: 0, lastAt: 0, cwd: "/w/DEV-88-other", ...extra });
    const st = (sessions: object[], prs: object[] = []) =>
        ({ now: Date.parse("2026-09-28T09:00:00Z"), sessions, projects: [], plugins: { "gh-prs": { ok: true, at: 0, data: { me: "me", prs } } } }) as unknown as WintosState;

    test("no Claude session in the pane, no header", () => expect(sessionHeader(st([]), "b")).toBeUndefined());
    test("an ended session has none either", () => expect(sessionHeader(st([sess({ state: "ended" })]), "b")).toBeUndefined());

    test("its PRs with their queue group and why; the task and branch from the first PR", () => {
        const h = sessionHeader(st([sess({ prs: [p(1).url, p(2).url] })], [p(1, { checks: "FAILURE" }), p(2, { reviewers: ["ana"] })]), "b")!;
        expect(h.prs.map((x) => [x.number, x.group, x.text])).toEqual([[1, "fix", "CI red"], [2, "chase", "chase · nudge ana · 5 wd"]]);
        expect([h.task, h.branch]).toEqual(["DEV-77", "DEV-77-thing"]);
    });

    test("a past-SLA PR makes the stripe brick, a fix apricot, nothing else none", () => {
        expect(sessionHeader(st([sess({ prs: [p(1).url, p(2).url] })], [p(1, { checks: "FAILURE" }), p(2, { reviewers: ["ana"] })]), "b")!.tone).toBe("brick");
        expect(sessionHeader(st([sess({ prs: [p(1).url] })], [p(1, { checks: "FAILURE" })]), "b")!.tone).toBe("apricot");
        expect(sessionHeader(st([sess({ prs: [p(1).url] })], [p(1, { createdAt: "2026-09-28T08:00:00Z" })]), "b")!.tone).toBeUndefined();
    });

    test("done PRs drop out: one gone from the PR list has no chip, a merged one only counts", () => {
        const h = sessionHeader(st([sess({ prs: ["https://github.com/acme/api/pull/9", p(3).url, p(1).url] })], [p(3, { mergedAt: "2026-09-27T08:00:00Z" }), p(1)]), "b")!;
        expect([h.prs.map((x) => x.number), h.merged]).toEqual([[1], 1]);
    });

    test("most urgent first; the repo only on a PR outside the session's own; a draft says so", () => {
        const other = { ...p(7, { reviewers: ["ana"] }), repo: "acme/Wint.Embedding.Service", url: "https://github.com/acme/Wint.Embedding.Service/pull/7" };
        const h = sessionHeader(st([sess({ prs: [p(2).url, other.url, p(1).url] })], [p(2, { isDraft: true, createdAt: "2026-09-28T08:00:00Z" }), other, p(1, { conflict: true })]), "b")!;
        expect(h.prs.map((x) => [x.number, x.repo, x.text])).toEqual([[1, undefined, "merge conflict"], [7, "Embedding", "chase · nudge ana · 5 wd"], [2, undefined, "draft"]]);
    });

    test("the fixer at work on the PR's commit says so on its chip", () => {
        const fixer = { conflicts: true, queued: [], runs: [{ id: "r", kind: "conflict", url: p(1).url, head: "h1", route: "fresh", at: 1, startedAt: 2 }] };
        const state = { ...st([sess({ prs: [p(1).url] })], [p(1, { conflict: true, head: "h1" })]), fixer } as unknown as WintosState;
        expect(sessionHeader(state, "b")!.prs[0].text).toBe("fixing the conflict…");
    });

    test("without PR data yet, every PR shows as a bare number", () =>
        expect(sessionHeader({ ...st([sess({ prs: [p(9).url] })]), plugins: {} } as unknown as WintosState, "b")!.prs).toEqual([{ url: p(9).url, number: 9 }]));

    test("⌥⌘G opens the PR the queue would put first", () => {
        const h = sessionHeader(st([sess({ prs: [p(1).url, p(2).url] })], [p(1, { reviewers: ["ana"], createdAt: "2026-09-28T08:00:00Z" }), p(2, { checks: "FAILURE" })]), "b");
        expect(urgentPr(h)?.number).toBe(2);
    });

    test("without PRs the task and branch come from where it runs", () => {
        const h = sessionHeader(st([sess()]), "b")!;
        expect([h.task, h.branch]).toEqual(["DEV-88", "DEV-88-other"]);
    });
});

describe("projectSessions (the notes' Sessions section, and ⌥⌘1–9)", () => {
    const st = {
        now: 0, projects: [],
        sessions: [
            { id: "a", tabId: "t", blockId: "b2", state: "waiting", since: 0, lastAt: 0, status: { text: "reading the failing test", at: 0 }, name: { text: "fixing the parser", by: "session", at: 0 }, prs: ["https://github.com/o/r/pull/1"] },
            { id: "b", tabId: "t", blockId: "b1", state: "working", since: 0, lastAt: 0, label: "first" },
            { id: "c", tabId: "t", blockId: "gone", state: "waiting", since: 0, lastAt: 0 },
            { id: "d", tabId: "t", blockId: "b3", state: "ended", since: 0, lastAt: 0 },
        ],
        shelf: { t: [{ sessionId: "z", script: "s", label: "l", title: "Deploy the stack", at: 0, prs: ["https://github.com/o/r/pull/2"] }] },
    } as unknown as WintosState;
    test("a pane running two sessions (a fork in the background) lists both", () => {
        const both = { ...st, sessions: [...(st.sessions as never[]), { id: "f", tabId: "t", blockId: "b1", state: "waiting", since: 0, lastAt: 0, label: "the fork" }] } as unknown as WintosState;
        expect(projectSessions(both, "t", ["b1"]).filter((x) => x.kind === "live").map((x) => x.name)).toEqual(["first", "the fork"]);
    });

    test("live ones in pane order (closed panes and ended sessions left out), then the shelved, each with its PRs", () => {
        const list = projectSessions(st, "t", ["b1", "b2", "b3"]);
        expect(list.map((x) => [x.kind, x.name, x.prs.map((p) => p.number)])).toEqual([["live", "first", []], ["live", "fixing the parser", [1]], ["shelved", "Deploy the stack", [2]]]);
    });
});

describe("when you last touched a session and a project", () => {
    const sess = (id: string, extra: object = {}) => ({ id, tabId: "t", blockId: "b", state: "waiting", since: 0, lastAt: 5, ...extra });
    test("a session: the later of looking at it and prompting it, else its last event", () => {
        const state = { now: 0, projects: [], sessions: [], seen: { a: 30 } } as unknown as WintosState;
        expect([sessionTouched(state, sess("a", { promptAt: 20 }) as never), sessionTouched(state, sess("b", { promptAt: 20 }) as never), sessionTouched(state, sess("c") as never)]).toEqual([30, 20, 5]);
    });
    test("a project: the latest of its sessions, live or shelved, and its shelvings; none without either", () => {
        const state = { now: 0, projects: [], sessions: [sess("a", { promptAt: 20 })], seen: { z: 50 }, shelf: { t: [{ sessionId: "z", script: "x", label: "l", at: 40 }] } } as unknown as WintosState;
        expect([projectTouched(state, "t"), projectTouched(state, "other")]).toEqual([50, undefined]);
    });
});
