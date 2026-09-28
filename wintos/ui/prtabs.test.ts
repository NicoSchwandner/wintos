import { describe, expect, test } from "vitest";
import { closeTab, openTab, stepTab } from "./prtabs";

const A = "https://github.com/acme/api/pull/1";
const B = "https://github.com/acme/api/pull/2";

describe("openTab", () => {
    test("opening a PR adds a tab and shows it", () => {
        expect(openTab({ urls: [A], active: 0 }, B)).toEqual({ urls: [A, B], active: 1 });
    });

    test("a PR that is already open is shown, not opened twice", () => {
        expect(openTab({ urls: [A, B], active: 1 }, A)).toEqual({ urls: [A, B], active: 0 });
    });
});

describe("closeTab", () => {
    test("closing the shown tab shows its left neighbour", () => {
        expect(closeTab({ urls: [A, B], active: 1 }, 1)).toEqual({ urls: [A], active: 0 });
    });

    test("closing the first tab shows the next one", () => {
        expect(closeTab({ urls: [A, B], active: 0 }, 0)).toEqual({ urls: [B], active: 0 });
    });

    test("closing a tab left of the shown one keeps showing the same PR", () => {
        expect(closeTab({ urls: [A, B], active: 1 }, 0)).toEqual({ urls: [B], active: 0 });
    });

    test("closing the last tab leaves none", () => {
        expect(closeTab({ urls: [A], active: 0 }, 0)).toEqual({ urls: [], active: 0 });
    });
});

describe("stepTab", () => {
    test("moves to the next or previous tab, wrapping", () => {
        const t = { urls: [A, B], active: 1 };
        expect(stepTab(t, 1)).toEqual({ urls: [A, B], active: 0 });
        expect(stepTab(t, -1)).toEqual({ urls: [A, B], active: 0 });
        expect(stepTab({ urls: [A, B], active: 0 }, -1)).toEqual({ urls: [A, B], active: 1 });
    });

    test("no tabs, nothing to step", () => {
        expect(stepTab({ urls: [], active: 0 }, 1)).toEqual({ urls: [], active: 0 });
    });
});
