import { describe, expect, test } from "vitest";
import { countdown, meetingsFrom, meetingToJoin, nextMeetings, setLatestMeetings, WARN_MS } from "./meetings";

const NOW = Date.parse("2026-10-02T13:28:00Z");
const at = (hhmm: string) => `2026-10-02T${hhmm}:00Z`;
const m = (title: string, start: string, end: string, extra = {}) => ({ title, start: at(start), end: at(end), ...extra });

describe("meetingsFrom", () => {
    test("collects every plugin's meetings, drops malformed and all-day ones, sorted by start", () => {
        const plugins = {
            cal: { ok: true, at: 0, data: { meetings: [m("B", "15:00", "15:30"), m("A", "13:30", "14:15", { url: "https://meet.google.com/abc" }), { title: "broken" }, m("Holiday", "00:00", "23:59", { allDay: true })] } },
            other: { ok: true, at: 0, data: { panel: {} } },
        };
        expect(meetingsFrom(plugins).map((x) => [x.title, x.url])).toEqual([["A", "https://meet.google.com/abc"], ["B", undefined]]);
    });

    test("a link that is not http(s) is dropped", () => expect(meetingsFrom({ c: { ok: true, at: 0, data: { meetings: [m("A", "13:30", "14:00", { url: "javascript:x" })] } } })[0].url).toBeUndefined());
});

describe("nextMeetings", () => {
    const tomorrow = { title: "Tomorrow", start: "2026-10-03T09:00:00Z", end: "2026-10-03T09:15:00Z" };
    const list = meetingsFrom({ c: { ok: true, at: 0, data: { meetings: [m("Daily", "10:00", "10:15"), m("Refinement", "13:30", "14:15"), m("1:1", "15:00", "15:30"), tomorrow] } } });

    test("the next one to start, the one after it, and how long until it", () => {
        const n = nextMeetings(list, NOW - 26 * 60_000);
        expect([n.next?.title, n.after?.title, n.msLeft, n.soon]).toEqual(["Refinement", "1:1", 28 * 60_000, false]);
    });

    test("within two minutes of the start it is soon", () => {
        expect(nextMeetings(list, NOW).soon).toBe(true);
        expect(nextMeetings(list, Date.parse(at("13:30")) - WARN_MS - 1).soon).toBe(false);
    });

    test("one that is on now is shown as now, and the next comes after it", () => {
        const n = nextMeetings(list, Date.parse(at("13:40")));
        expect([n.now?.title, n.next?.title, n.soon]).toEqual(["Refinement", "1:1", false]);
    });

    test("only today's: after the last one there is nothing next", () => expect(nextMeetings(list, Date.parse(at("16:00"))).next).toBeUndefined());
});

describe("countdown", () => {
    test.each([
        [111_000, "in 1:51"],
        [120_000, "in 2:00"],
        [121_000, "in 3 min"],
        [28 * 60_000, "in 28 min"],
        [65 * 60_000, "in 1 h 5 min"],
        [-5_000, "in 0:00"],
    ])("%i ms → %s", (ms, out) => expect(countdown(ms)).toBe(out));
});

describe("meetingToJoin", () => {
    const list = meetingsFrom({ c: { data: { meetings: [m("On now", "13:00", "13:45", { url: "https://meet.google.com/now" }), m("Next", "14:00", "14:30", { url: "https://meet.google.com/next" }), m("No link", "15:00", "15:30")] } } });

    test("the one on now, else the next with a link, else none", () => {
        setLatestMeetings(list);
        expect(meetingToJoin(Date.parse(at("13:20")))?.title).toBe("On now");
        expect(meetingToJoin(Date.parse(at("13:50")))?.title).toBe("Next");
        expect(meetingToJoin(Date.parse(at("14:40")))).toBeUndefined();
    });
});
