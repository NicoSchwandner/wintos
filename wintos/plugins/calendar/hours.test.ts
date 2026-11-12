import { expect, test } from "vitest";
import { meetingMs } from "./hours";

const m = (start: string, end: string, more = {}) => ({ title: "x", start: `2026-11-03T${start}:00Z`, end: `2026-11-03T${end}:00Z`, ...more });

test("overlapping meetings count once; all-day ones and invites you haven't accepted not at all", () =>
    expect(meetingMs([m("09:00", "10:00"), m("09:30", "10:30"), m("13:00", "13:30"), m("14:00", "15:00", { reply: "pending" }), m("00:00", "23:59", { allDay: true })])).toBe(2 * 3_600_000));

test("no meetings: nothing", () => expect(meetingMs([])).toBe(0));
