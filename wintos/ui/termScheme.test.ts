import { describe, expect, test } from "vitest";
import type { Session } from "../daemon/sessions/reduce";
import { backgroundReply, isDarkBg, schemeNotices, schemeReport } from "./termScheme";

describe("terminal colour scheme", () => {
    test("OSC 11 reply carries the background without its transparency", () => {
        expect(backgroundReply("#fbfaf680")).toBe("\x1b]11;rgb:fbfb/fafa/f6f6\x1b\\");
        expect(backgroundReply("#141311")).toBe("\x1b]11;rgb:1414/1313/1111\x1b\\");
    });
    test("the scheme report: 1 for dark, 2 for light", () => {
        expect(schemeReport(isDarkBg("#141311"))).toBe("\x1b[?997;1n");
        expect(schemeReport(isDarkBg("#fbfaf680"))).toBe("\x1b[?997;2n");
    });
});

describe("schemeNotices", () => {
    const s = (id: string, o: Partial<Session> = {}) => ({ id, tabId: "t1", blockId: `b-${id}`, state: "idle", since: 0, lastAt: 0, ...o }) as Session;
    test("each live Claude pane in this tab, once", () => {
        const sessions = [s("a"), s("b", { state: "working" }), s("other", { tabId: "t2" }), s("gone", { state: "ended" }), s("bg", { background: true }), s("saved", { restored: true })];
        expect(schemeNotices(sessions, "t1", new Set())).toEqual(["b-a", "b-b"]);
        expect(schemeNotices(sessions, "t1", new Set(["b-a"]))).toEqual(["b-b"]);
    });
});
