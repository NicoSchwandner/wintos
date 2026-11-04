import { describe, expect, test } from "vitest";
import type { Session } from "../sessions/reduce";
import { addReport, delivered, reportLine, REPORTS_MAX } from "./reports";

const s = (more: Partial<Session>): Session => ({ id: "w", tabId: "t", blockId: "b", state: "idle", since: 0, lastAt: 0, ...more }) as Session;

describe("reportLine", () => {
    test("a turn that asks: who, where in its lane, what it asks", () =>
        expect(reportLine(s({ name: { text: "Drafts mapping", by: "you", at: 0 } as Session["name"], state: "waiting", lane: { name: "feature", steps: ["Build", "?Your OK"], at: 1 } as Session["lane"], ask: { kind: "decide", text: "DraftId or hash?" } as Session["ask"] }))).toBe(
            "Drafts mapping (at Your OK) needs a decision: DraftId or hash?"
        ));
    test("parked, done, or a plain end with what it said", () => {
        expect(reportLine(s({ label: "export", state: "parked", parkedOn: "CI on #418" }))).toBe("export waits on CI on #418");
        expect(reportLine(s({ label: "export", state: "done" }))).toBe("export is done");
        expect(reportLine(s({ label: "export", state: "idle", outcome: { text: "Pushed the fix.", at: 0 } }))).toBe("export Pushed the fix.");
    });
});

describe("the queue", () => {
    test("a repeated line moves to the end instead of piling up; the oldest drop past the cap", () => {
        let r = addReport(addReport({}, "a", "x", 1), "a", "y", 2);
        r = addReport(r, "a", "x", 3);
        expect(r.a.map((x) => x.text)).toEqual(["y", "x"]);
        for (let i = 0; i < REPORTS_MAX + 5; i++) r = addReport(r, "a", `n${i}`, 10 + i);
        expect(r.a.length).toBe(REPORTS_MAX);
        expect(r.a[0].text).toBe("n5");
    });
    test("delivered takes the first ones off, and the agent's entry when none are left", () => {
        const r = addReport(addReport({}, "a", "x", 1), "a", "y", 2);
        expect(delivered(r, "a", 1)).toEqual({ a: [{ text: "y", at: 2 }] });
        expect(delivered(r, "a", 2)).toEqual({});
    });
});
