import { describe, expect, test } from "vitest";
import type { Row } from "../daemon/ranking/rank";
import type { Session } from "../daemon/sessions/reduce";
import type { WintosState } from "./view";
import { attention, plain, prsByTab, rowView, sidebarModel } from "./attention";

const NOW = 1_000_000_000;
const row = (band: Row["band"], extra: Partial<Row> = {}): Row => ({ key: extra.tabId ?? "t", tabId: "t", band, lastAt: NOW - 60_000, sessions: [], ...extra });

describe("rowView", () => {
    test("running behind an ended turn says what it waits for", () => {
        const behind = { id: "a", tabId: "t", blockId: "b", state: "waiting", since: NOW, lastAt: NOW, subagents: { x: NOW - 1000, y: NOW - 500 } } as Session;
        expect(rowView(row("running", { sessions: [behind] }), undefined, "T1", NOW).next).toBe("2 subagents still running; comes back by itself");
    });

    test("needs: apricot next action, age since the wait began", () => {
        const v = rowView(row("needs", { waitingSince: NOW - 3 * 60_000 }), { dir: "/p", mtime: 0, title: "Invoice OCR", next: "Approve the plan", pr: ["Core#1"] }, "T1", NOW);
        expect(v).toMatchObject({ title: "Invoice OCR", next: "Approve the plan", tone: "apricot", meta: "Core#1", age: "3m" });
    });

    test("needs without a next action still says whose turn it is", () => {
        expect(rowView(row("needs", { waitingSince: NOW }), undefined, "T1", NOW)).toMatchObject({ title: "T1", next: "Your turn", tone: "apricot" });
    });

    test("quiet on a parked session says what it waits on, in place of the PR reason", () => {
        const parked = { id: "s", tabId: "t", blockId: "b", state: "parked", since: NOW, lastAt: NOW, parkedOn: "review on #1479" } as const;
        expect(rowView(row("quiet", { sessions: [parked] }), { dir: "/p", mtime: 0, title: "X", pr: [] }, "T", NOW)).toMatchObject({ reason: "paused on review on #1479" });
    });

    test("running on a parked session says what it waits on", () => {
        const parked = { id: "s", tabId: "t", blockId: "b", state: "parked", since: NOW, lastAt: NOW, parkedOn: "CI on #1479" } as const;
        expect(rowView(row("running", { sessions: [parked] }), { dir: "/p", mtime: 0, title: "X", next: "Mark #1479 ready", pr: [] }, "T", NOW)).toMatchObject({ next: "Paused on CI on #1479", tone: "secondary" });
    });

    test("running: neutral line, Claude named as the one working", () => {
        expect(rowView(row("running"), undefined, "T2", NOW)).toMatchObject({ next: "Claude is working", tone: "secondary", age: "1m" });
    });

    test("quiet: no next line, the reason column carries a PR or a bare age", () => {
        const v = rowView(row("quiet"), { dir: "/p", mtime: 0, pr: ["Core#9"] }, "T", NOW);
        expect(v.next).toBeUndefined();
        expect(v.reason).toBe("Core#9");
        expect(rowView(row("quiet"), undefined, "T", NOW)).toMatchObject({ reason: "1m" });
    });

    test("an unreadable note is shown in brick with its path, never hidden", () => {
        expect(rowView(row("quiet"), { dir: "/p/x", mtime: 0, error: "no front matter" }, "T", NOW)).toMatchObject({ next: "note unreadable: /p/x/project.md", tone: "brick" });
    });

    test("nothing known about a tab shows no age, not one counted from 1970", () => {
        const v = rowView(row("quiet", { lastAt: 0 }), undefined, "T", NOW);
        expect([v.age, v.reason]).toEqual(["", ""]);
    });

    test("with no project and no tab name it is Untitled", () => {
        expect(rowView(row("quiet"), undefined, undefined, NOW).title).toBe("Untitled");
    });
});

describe("rowView with PRs", () => {
    const blocked = { items: [{ pr: { repo: "o/r", number: 4803, branch: "fix/bank-retry" } as never, group: "chase" as const }], blocked: { since: NOW, text: "Nobody has looked at #4803 in 4 working days", tone: "brick" as const, url: "https://github.com/o/r/pull/4803" } };
    test("a PR that needs you is the quiet row's line, not a reason to need you", () =>
        expect(rowView(row("quiet"), { dir: "/p", mtime: 0 }, "T", NOW, blocked)).toMatchObject({ reason: "Nobody has looked at #4803 in 4 working days" }));
    test("a PR only the notes name shows by its short name, not its link", () =>
        expect(rowView(row("running"), { dir: "/p", mtime: 0, pr: ["https://github.com/o/Acme.Docs/pull/72"] }, "T", NOW, undefined, () => "Docs").meta).toBe("Docs #72"));
    test("its PR line carries the repo's short name", () => {
        expect(rowView(row("running"), undefined, "T", NOW, blocked).meta).toBe("r #4803 · fix/bank-retry");
        expect(rowView(row("running"), undefined, "T", NOW, blocked, () => "R").meta).toBe("R #4803 · fix/bank-retry");
    });
    test("a waiting session still wins the next-action line", () =>
        expect(rowView(row("needs", { waitingSince: NOW, sessions: [{ state: "waiting" } as never] }), undefined, "T", NOW, blocked)).toMatchObject({ next: "Your turn", tone: "apricot" }));
    test("quiet rows take the PR's reason", () =>
        expect(rowView(row("quiet"), undefined, "T", NOW, { items: [], reason: "#4812 with ana.b" }).reason).toBe("#4812 with ana.b"));
});

describe("sidebarModel", () => {
    test("only tabs of this workspace appear, ranked by the daemon's rules", () => {
        const m = sidebarModel(["a", "b"], {
            now: NOW,
            projects: [],
            sessions: [
                { id: "1", tabId: "b", blockId: "x", state: "waiting", since: NOW - 1, lastAt: NOW - 1 },
                { id: "2", tabId: "gone", blockId: "y", state: "waiting", since: NOW, lastAt: NOW },
            ],
        });
        expect(m.needs.map((r) => r.tabId)).toEqual(["b"]);
        expect(m.quiet.map((r) => r.tabId)).toEqual(["a"]);
    });

    test("a project whose PR needs you stays where its sessions put it: the PRs tab shows the PR", () => {
        const prs = { ok: true, at: NOW, data: { me: "me", prs: [{ repo: "o/r", number: 9, url: "u", title: "DEV-1", author: "me", isDraft: false, createdAt: "1970-01-01T00:00:00Z", conflict: false, requestedMe: false, requestedTeam: false, reviewedByMe: false, reviewers: [], additions: 1, deletions: 1, branch: "b" }] } };
        const m = sidebarModel(["a"], { now: NOW, sessions: [], projects: [{ id: "a", dir: "/p", mtime: 0, title: "DEV-1 thing", pr: [] }], plugins: { "gh-prs": prs } });
        expect([m.needs, m.quiet.map((r) => r.tabId)]).toEqual([[], ["a"]]);
    });

    test("the project file's mtime counts as activity", () => {
        const m = sidebarModel(["a"], { now: NOW, sessions: [], projects: [{ id: "a", dir: "/p", mtime: NOW - 5 }] });
        expect(m.quiet[0].lastAt).toBe(NOW - 5);
    });
});

describe("prsByTab: the PRs its sessions own count too, and the reason names the owner", () => {
    const red = { repo: "acme/api", number: 5, url: "https://github.com/acme/api/pull/5", title: "t", author: "me", isDraft: false, createdAt: "2026-09-28T08:00:00Z", conflict: false, checks: "FAILURE", requestedMe: false, requestedTeam: false, reviewedByMe: false, reviewers: [], additions: 1, deletions: 1, branch: "b" };
    const base = { now: Date.parse("2026-09-28T09:00:00Z"), projects: [{ id: "t1", title: "x", titleLocked: false, pr: [], dir: "/d", mtime: 0 }], plugins: { "gh-prs": { ok: true, at: 0, data: { me: "me", prs: [red] } } } };
    test("a live session's PR, named by the session's name, never its status line", () => {
        const state = { ...base, sessions: [{ id: "s", tabId: "t1", blockId: "b1", state: "parked", since: 0, lastAt: 0, prs: [red.url], status: { text: "waiting on CI", at: 0 }, name: { text: "deploying the stack", by: "session", at: 0 } }] } as unknown as WintosState;
        expect(prsByTab(["t1"], state).t1.blocked).toMatchObject({ text: "#5: CI red · deploying the stack", owner: { name: "deploying the stack", blockId: "b1" } });
    });
    test("a shelved session's PR, named by its title, resumable", () => {
        const state = { ...base, sessions: [], shelf: { t1: [{ sessionId: "z", script: "cd '/w' && claude --resume 'z'", label: "l", title: "Deploy stack to test", prs: [red.url], at: 0 }] } } as unknown as WintosState;
        expect(prsByTab(["t1"], state).t1.blocked).toMatchObject({ text: "#5: CI red · shelved: Deploy stack to test", owner: { name: "Deploy stack to test", resume: "cd '/w' && claude --resume 'z'" } });
    });
});

describe("prsByTab with snoozes", () => {
    test("a snoozed PR no longer puts its project in Needs you", () => {
        const prs = [{ repo: "acme/api", number: 5, url: "https://github.com/acme/api/pull/5", title: "t", author: "me", isDraft: false, createdAt: "2026-09-28T08:00:00Z", conflict: false, checks: "FAILURE", requestedMe: false, requestedTeam: false, reviewedByMe: false, reviewers: [], additions: 1, deletions: 1, branch: "b" }];
        const state = { now: Date.parse("2026-09-28T09:00:00Z"), sessions: [], projects: [{ id: "t1", title: "x", titleLocked: false, pr: ["acme/api#5"], dir: "/d", mtime: 0 }], plugins: { "gh-prs": { ok: true, at: 0, data: { me: "me", prs } } } } as unknown as WintosState;
        expect(prsByTab(["t1"], state).t1.blocked).toBeDefined();
        const snoozed = { ...state, snoozes: { [prs[0].url]: { until: state.now + 1, movedAt: prs[0].createdAt } } };
        expect(prsByTab(["t1"], snoozed).t1.blocked).toBeUndefined();
    });
});

describe("rowView after a restart", () => {
    test("a project whose sessions haven't started again says so", () => {
        const r: Row = { key: "t", tabId: "t", band: "needs", lastAt: 1, waitingSince: 1, sessions: [{ id: "s", tabId: "t", blockId: "b", state: "waiting", since: 1, lastAt: 1, restored: true }] };
        expect(rowView(r, { dir: "/p", mtime: 0, title: "X", pr: ["Core#1"] }, "T", 10).meta).toBe("Core#1 · starts when opened");
        expect(rowView({ ...r, sessions: [{ ...r.sessions[0], restored: undefined }] }, { dir: "/p", mtime: 0, title: "X", pr: ["Core#1"] }, "T", 10).meta).toBe("Core#1");
    });
});

describe("rowView of an unread reply", () => {
    test("a done session's reply that said nothing falls back to the project's next action", () => {
        const r: Row = { key: "t", tabId: "t", band: "read", lastAt: 5, waitingSince: 5, unread: true, sessions: [{ id: "s", tabId: "t", blockId: "b", state: "done", since: 5, lastAt: 5, turnEndedAt: 5 }] };
        expect(rowView(r, { dir: "/p", mtime: 0, title: "X", next: "Ship it", pr: [] }, "T", 10)).toMatchObject({ next: "Ship it", tone: "blue" });
    });
});

describe("a row says how the last turn ended", () => {
    const sess = (state: Session["state"], extra: Partial<Session> = {}): Session => ({ id: "s", tabId: "t", blockId: "b", state, since: 5, lastAt: 5, turnEndedAt: 5, outcome: { text: "Fixed the walk", at: 5 }, ...extra });
    test("to read: what it said, in blue", () => {
        const r: Row = { key: "t", tabId: "t", band: "read", lastAt: 5, waitingSince: 5, unread: true, sessions: [sess("parked", { parkedOn: "CI" })] };
        expect(rowView(r, { dir: "/p", mtime: 0, title: "X", next: "Ship it", pr: [] }, "T", 10)).toMatchObject({ next: "Fixed the walk", tone: "blue" });
    });
    test("your move: what the turn expects of you, then what about", () => {
        const line = (v: { kind?: string; next?: string }) => [v.kind, v.next].filter(Boolean).join(" · ");
        const move = (ask: Session["ask"], outcome = true) => line(rowView({ key: "t", tabId: "t", band: "needs", lastAt: 5, waitingSince: 5, sessions: [sess("waiting", { ask, ...(outcome ? {} : { outcome: undefined }) })] }, undefined, "T", 10));
        expect(move({ kind: "decide", text: "two bands or one", by: "session" })).toBe("Decide · two bands or one");
        expect(move({ kind: "decide", text: "two bands or one", by: "session", suggestion: "one" })).toBe("Decide · two bands or one · agent suggests: one");
        expect(move({ kind: "unblock", by: "model" })).toBe("Unblock · Fixed the walk");
        expect(move({ kind: "unblock", by: "model" }, false)).toBe("Unblock");
        expect(move(undefined)).toBe("Fixed the walk");
    });
    test("a question mid-turn points at the pane, not at the last turn's outcome", () => {
        const move = (kind: "answer" | "approve") => {
            const v = rowView({ key: "t", tabId: "t", band: "needs", lastAt: 5, waitingSince: 5, sessions: [sess("waiting", { ask: { kind, by: "tool" } })] }, undefined, "T", 10);
            return `${v.kind} · ${v.next}`;
        };
        expect([move("answer"), move("approve")]).toEqual(["Answer · its question", "Approve · its plan"]);
    });
    test("quiet: what it waits on, else what it said", () => {
        expect(rowView(row("quiet", { sessions: [sess("parked", { parkedOn: "CI" })] }), undefined, "T", NOW).reason).toBe("paused on CI");
        expect(rowView(row("quiet", { sessions: [sess("done")] }), undefined, "T", NOW).reason).toBe("Fixed the walk");
    });
    test("opening an unread project lands on the session with the reply", () => {
        const a = attention(["t"], { now: 10, sessions: [sess("done")], projects: [], seen: {} } as unknown as WintosState, {}, 10);
        expect(a.targets.t).toEqual({ tabId: "t", blockId: "b" });
    });
});

describe("attention", () => {
    test("the bands and a view for every row", () => {
        const a = attention(["a", "b"], {
            now: NOW,
            projects: [{ id: "a", title: "Alpha", dir: "/a", mtime: 0 } as never, { id: "b", title: "Beta", dir: "/b", mtime: 0 } as never],
            sessions: [{ id: "1", tabId: "a", blockId: "x", state: "waiting", since: NOW - 1, lastAt: NOW - 1 }],
        }, {}, NOW);
        expect([a.needs.map((r) => r.tabId), a.quiet.map((r) => r.tabId), a.views.a.title, a.views.b.title]).toEqual([["a"], ["b"], "Alpha", "Beta"]);
    });
});

describe("the hold: breaks", () => {
    const T = NOW;
    const st = (rhythm: object, waitingSince: number): WintosState => ({
        now: T + 6 * 60_000,
        projects: [{ id: "a", title: "Alpha", dir: "/a", mtime: 0 } as never, { id: "b", title: "Beta", dir: "/b", mtime: 0 } as never],
        sessions: [{ id: "1", tabId: "a", blockId: "x", state: "waiting", since: waitingSince, lastAt: waitingSince, ask: { kind: "approve", text: "ship it?", by: "session" } }],
        rhythm: { day: "d", stretchFrom: 0, breaks: [], everyMs: 0, ...rhythm },
    }) as WintosState;

    test("a turn that came in during a break waits in Quiet until you are back", () => {
        const a = attention(["a", "b"], st({ onBreak: T + 2 * 60_000 }, T + 5 * 60_000), {}, T + 6 * 60_000, "b");
        expect([a.needs.map((r) => r.tabId), a.quiet.map((r) => r.tabId)[0]]).toEqual([[], "a"]);
        expect(a.views.a.reason).toBe("held until you are back · Approve · ship it?");
        expect(attention(["a", "b"], st({}, T + 5 * 60_000), {}, T + 6 * 60_000, "b").needs.map((r) => r.tabId)).toEqual(["a"]);
    });

    test("the project you are in is never held", () =>
        expect(attention(["a", "b"], st({ onBreak: T + 2 * 60_000 }, T + 5 * 60_000), {}, T + 6 * 60_000, "a").needs.map((r) => r.tabId)).toEqual(["a"]));

    test("approvals lead Your move: the quick ones first", () => {
        const state = { ...st({}, T), sessions: [
            { id: "1", tabId: "a", blockId: "x", state: "waiting", since: T - 60_000, lastAt: T, ask: { kind: "decide", by: "model" } },
            { id: "2", tabId: "b", blockId: "y", state: "waiting", since: T - 9 * 60_000, lastAt: T, ask: { kind: "approve", by: "model" } },
        ] } as WintosState;
        expect(attention(["a", "b"], state, {}, T).needs.map((r) => r.tabId)).toEqual(["b", "a"]);
    });
});

describe("attention targets: where a click on a row that needs you lands", () => {
    const red = { repo: "acme/api", number: 5, url: "https://github.com/acme/api/pull/5", title: "t", author: "me", isDraft: false, createdAt: "2026-09-28T08:00:00Z", conflict: false, checks: "FAILURE", requestedMe: false, requestedTeam: false, reviewedByMe: false, reviewers: [], additions: 1, deletions: 1, branch: "b" };
    const base = { now: Date.parse("2026-09-28T09:00:00Z"), projects: [{ id: "t1", title: "x", titleLocked: false, pr: [], dir: "/d", mtime: 0 }], plugins: { "gh-prs": { ok: true, at: 0, data: { me: "me", prs: [red] } } } };
    const ses = (id: string, state: string, since: number, extra = {}) => ({ id, tabId: "t1", blockId: `b-${id}`, state, since, lastAt: since, ...extra });
    test("the session waiting longest", () => {
        const a = attention(["t1"], { ...base, sessions: [ses("new", "waiting", 20), ses("old", "waiting", 10)] } as unknown as WintosState, {}, base.now);
        expect(a.targets.t1).toEqual({ tabId: "t1", blockId: "b-old" });
    });
    test("a project with only a red PR needs nothing, so it has no target", () => {
        const a = attention(["t1"], { ...base, sessions: [ses("p", "parked", 10, { prs: [red.url] })] } as unknown as WintosState, {}, base.now);
        expect([a.needs, a.targets.t1]).toEqual([[], undefined]);
    });
});

describe("a due wake on its way", () => {
    const wake = { sessionId: "s1", pr: "https://github.com/o/r/pull/7", until: "rereview" as const, prompt: "re-review", at: 0, expires: 9, due: 5 };
    const st = (o: object) => ({ now: NOW, sessions: [], projects: [{ id: "t1", dir: "/p", mtime: 0, title: "Review" }], wakes: { s1: wake }, ...o }) as never;
    test("keeps its project in Your move while the session resumes, with what woke it", () => {
        const a = attention(["t1"], st({ shelf: { t1: [{ sessionId: "s1", script: "x", label: "l", at: 0 }] } }), {}, NOW);
        expect([a.needs.map((r) => r.tabId), a.views.t1.next, a.views.t1.tone]).toEqual([["t1"], "r #7 asks for your re-review · waking the session", "apricot"]);
    });
    test("no due wake, no lift", () => {
        const a = attention(["t1"], st({ wakes: { s1: { ...wake, due: undefined } }, shelf: { t1: [{ sessionId: "s1", script: "x", label: "l", at: 0 }] } }), {}, NOW);
        expect(a.needs).toEqual([]);
    });
});

describe("attention by session (the sidebar)", () => {
    const sessions = [
        { id: "w", tabId: "t1", blockId: "b-w", state: "waiting", since: 5, lastAt: 5, name: { text: "Drafts mapping", by: "you", at: 0 } },
        { id: "r", tabId: "t1", blockId: "b-r", state: "working", since: 5, lastAt: 5, label: "export check" },
        { id: "q", tabId: "t2", blockId: "b-q", state: "idle", since: 1, lastAt: 1, label: "alone" },
    ];
    const state = { now: 10, sessions, projects: [{ id: "t1", title: "Route docs", titleLocked: false, pr: [], dir: "/d", mtime: 0 }], seen: {} } as unknown as WintosState;
    const a = attention(["t1", "t2", "t3"], state, {}, 10, undefined, true);
    test("each session is a row named after it; a tab with none keeps its own", () => {
        expect(a.needs.map((r) => r.key)).toEqual(["s:w"]);
        expect(a.running.map((r) => r.key)).toEqual(["s:r"]);
        expect([...a.quiet, ...a.quietMore].map((r) => r.key).sort()).toEqual(["s:q", "t3"]);
        expect([a.views["s:w"].title, a.views["s:r"].title]).toEqual(["Drafts mapping", "export check"]);
    });
    test("sessions sharing a tab say which view; one alone in its tab doesn't", () => {
        expect(a.views["s:w"].view).toBe("⧉ Route docs");
        expect(a.views["s:q"].view).toBeUndefined();
    });
    test("every session row lands on its own pane; its tab still lands on what waits on you", () => {
        expect(a.targets["s:r"]).toEqual({ tabId: "t1", blockId: "b-r" });
        expect(a.targets["t1"]).toEqual({ tabId: "t1", blockId: "b-w" });
    });
    test("by project, as the palette asks, a tab is one row as before", () => expect(attention(["t1"], state, {}, 10).needs.map((r) => r.key)).toEqual(["t1"]));
});

test("plain: a Markdown link keeps its words, code and bold lose their marks", () => {
    expect(plain("[Core#14692](https://github.com/x/y/pull/14692) merged, `ci` **green**")).toBe("Core#14692 merged, ci green");
});
