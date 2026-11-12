import { describe, expect, test } from "vitest";
import { live, pushed, UNDO_MAX, UNDO_TTL_MS, type Undo } from "./undo";

const u = (at: number, label = `u${at}`): Undo => ({ kind: "pr-snooze", url: "https://github.com/o/r/pull/1", label, at });

describe("the undo stack", () => {
    test("newest first, the oldest dropped past the cap", () => {
        let s: Undo[] = [];
        for (let i = 1; i <= UNDO_MAX + 2; i++) s = pushed(s, u(i), i);
        expect([s.length, s[0].at, s.at(-1)!.at]).toEqual([UNDO_MAX, UNDO_MAX + 2, 3]);
    });

    test("what is older than the age limit is gone", () => {
        expect(live([u(UNDO_TTL_MS), u(1)], UNDO_TTL_MS + 2).map((x) => x.at)).toEqual([UNDO_TTL_MS]);
        expect(pushed([u(1)], u(UNDO_TTL_MS + 5), UNDO_TTL_MS + 5).map((x) => x.at)).toEqual([UNDO_TTL_MS + 5]);
    });
});
