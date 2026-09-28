import { describe, expect, test } from "vitest";
import type { Row } from "../daemon/ranking/rank";
import { isPlaceholderTab, prsByTab, relTime, rowView, sidebarModel, type WintosState } from "./view";

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

describe("rowView", () => {
    test("needs: apricot next action, age since the wait began", () => {
        const v = rowView(row("needs", { waitingSince: NOW - 3 * 60_000 }), { dir: "/p", mtime: 0, title: "Invoice OCR", next: "Approve the plan", pr: ["Core#1"] }, "T1", NOW);
        expect(v).toMatchObject({ title: "Invoice OCR", next: "Approve the plan", tone: "apricot", meta: "Core#1", age: "3m" });
    });

    test("needs without a next action still says whose turn it is", () => {
        expect(rowView(row("needs", { waitingSince: NOW }), undefined, "T1", NOW)).toMatchObject({ title: "T1", next: "Your turn", tone: "apricot" });
    });

    test("running on a parked session says what it waits on", () => {
        const parked = { id: "s", tabId: "t", blockId: "b", state: "parked", since: NOW, lastAt: NOW, parkedOn: "CI on #1479" } as const;
        expect(rowView(row("running", { sessions: [parked] }), { dir: "/p", mtime: 0, title: "X", next: "Mark #1479 ready", pr: [] }, "T", NOW)).toMatchObject({ next: "Waiting on CI on #1479", tone: "secondary" });
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
    const blocked = { items: [{ pr: { number: 4803, branch: "fix/bank-retry" } as never, group: "chase" as const }], blocked: { since: NOW, text: "Nobody has looked at #4803 in 4 working days", tone: "brick" as const } };
    test("a rotting PR speaks in brick when no session is waiting", () =>
        expect(rowView(row("needs", { waitingSince: NOW }), { dir: "/p", mtime: 0 }, "T", NOW, blocked)).toMatchObject({ next: "Nobody has looked at #4803 in 4 working days", tone: "brick", meta: "#4803 · fix/bank-retry" }));
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

    test("a project whose PR needs you is ranked into needs", () => {
        const prs = { ok: true, at: NOW, data: { me: "me", prs: [{ repo: "o/r", number: 9, url: "u", title: "DEV-1", author: "me", isDraft: false, createdAt: "1970-01-01T00:00:00Z", conflict: false, requestedMe: false, requestedTeam: false, reviewedByMe: false, reviewers: [], additions: 1, deletions: 1, branch: "b" }] } };
        const m = sidebarModel(["a"], { now: NOW, sessions: [], projects: [{ id: "a", dir: "/p", mtime: 0, title: "DEV-1 thing", pr: [] }], plugins: { "gh-prs": prs } });
        expect(m.needs.map((r) => r.tabId)).toEqual(["a"]);
    });

    test("the project file's mtime counts as activity", () => {
        const m = sidebarModel(["a"], { now: NOW, sessions: [], projects: [{ id: "a", dir: "/p", mtime: NOW - 5 }] });
        expect(m.quiet[0].lastAt).toBe(NOW - 5);
    });
});

describe("isPlaceholderTab", () => {
    const tab = (meta: Record<string, unknown>, blockids: string[] = []) => ({ meta, blockids }) as unknown as Tab;

    test("the empty tab that stands in when no project is open", () => {
        expect(isPlaceholderTab(tab({ "wintos:blank": true }))).toBe(true);
    });

    test("becomes a project once a pane is opened in it", () => {
        expect(isPlaceholderTab(tab({ "wintos:blank": true }, ["b1"]))).toBe(false);
    });

    test("an ordinary tab, or one not loaded yet, is a project", () => {
        expect(isPlaceholderTab(tab({}))).toBe(false);
        expect(isPlaceholderTab(undefined)).toBe(false);
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
