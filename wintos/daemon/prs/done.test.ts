import { describe, expect, test } from "vitest";
import { doneFrom, doneQuery, unlisted } from "./done";

const u = (n: number) => `https://github.com/o/r/pull/${n}`;

describe("unlisted", () => {
    test("each session PR once that neither the PR list nor the done ones know; not a URL, never", () =>
        expect(unlisted([u(1), u(2), u(1), u(3), "o/r#4"], new Set([u(2)]), { [u(3)]: { url: u(3), number: 3, repo: "o/r", merged: true } })).toEqual([u(1)]));
});

describe("doneQuery", () => {
    test("one request, a resource per URL", () =>
        expect(doneQuery([u(1), u(2)])).toBe(`{p0:resource(url:"${u(1)}"){... on PullRequest{url number state repository{nameWithOwner}}} p1:resource(url:"${u(2)}"){... on PullRequest{url number state repository{nameWithOwner}}}}`));
});

describe("doneFrom", () => {
    test("merged and closed ones; open and unknown ones are not done", () =>
        expect(doneFrom({
            p0: { url: u(1), number: 1, state: "MERGED", repository: { nameWithOwner: "o/r" } },
            p1: { url: u(2), number: 2, state: "CLOSED", repository: { nameWithOwner: "o/r" } },
            p2: { url: u(3), number: 3, state: "OPEN", repository: { nameWithOwner: "o/r" } },
            p3: null,
        })).toEqual([{ url: u(1), number: 1, repo: "o/r", merged: true }, { url: u(2), number: 2, repo: "o/r", merged: false }]));
});
