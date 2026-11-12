import { describe, expect, test } from "vitest";
import { findRefLinks, resolveRef } from "./refLinks";
import type { WintosState } from "./view";

const url = (repo: string, n: number) => `https://github.com/${repo}/pull/${n}`;
const pr = (repo: string, number: number) => ({ repo, number, url: url(repo, number) });
const st = (prs: object[], sessions: object[] = []) => ({ now: 0, sessions, projects: [], plugins: { "gh-prs": { ok: true, at: 0, data: { me: "me", prs } } } }) as unknown as WintosState;

describe("findRefLinks", () => {
    test("bare, repo and owner/repo references, with their columns", () =>
        expect(findRefLinks("see #352, Core#14129 and acme/api#77.")).toEqual([
            { start: 4, end: 8, number: 352 },
            { start: 10, end: 20, repo: "Core", number: 14129 },
            { start: 25, end: 36, repo: "acme/api", number: 77 },
        ]));
    test("a one-digit bare number, a colour or a URL anchor is no reference", () => expect(findRefLinks("step #1, #fff, x.com/a#123, ##12")).toEqual([]));
});

describe("resolveRef", () => {
    const prs = [pr("acme/api", 352), pr("acme/web", 352), pr("acme/web", 40)];
    test("a bare number: the pane's session's own PR first", () =>
        expect(resolveRef({ number: 352 }, st(prs, [{ blockId: "b", state: "working", lastAt: 0, prs: [url("acme/web", 352)] }]), "b")).toBe(url("acme/web", 352)));
    test("else the one open PR with that number", () => expect(resolveRef({ number: 40 }, st(prs), "b")).toBe(url("acme/web", 40)));
    test("two open PRs share the number: no guess", () => expect(resolveRef({ number: 352 }, st(prs), "b")).toBeUndefined());
    test("Repo#N finds the owner from any PR of that repo, open or not", () => expect(resolveRef({ repo: "web", number: 9 }, st(prs), "b")).toBe(url("acme/web", 9)));
    test("owner/repo#N links as written", () => expect(resolveRef({ repo: "o/r", number: 5 }, st([]), "b")).toBe(url("o/r", 5)));
    test("an unknown repo name stays plain", () => expect(resolveRef({ repo: "Nope", number: 5 }, st(prs), "b")).toBeUndefined());
});
