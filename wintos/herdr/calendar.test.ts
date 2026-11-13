import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createCalendarFeed } from "./backend/calendar";

vi.mock("node:fs", () => ({ readFileSync: vi.fn() }));

const Url = "https://calendar.example.test/private/synthetic.ics";
const Now = new Date(2026, 10, 13, 12).getTime();
const iso = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).toISOString();
const event = (uid: string, start: string, end: string, extra = "") => `BEGIN:VEVENT
UID:${uid}
SUMMARY:${uid}
DTSTART:${start}
DTEND:${end}
${extra}
END:VEVENT`;
const calendar = (...events: string[]) => `BEGIN:VCALENDAR
VERSION:2.0
X-WR-CALNAME:owner@example.test
${events.join("\n")}
END:VCALENDAR`;
const Meeting = event("Planning", "20261113T130000", "20261113T140000", `X-GOOGLE-CONFERENCE:https://meet.google.com/synthetic-call
ATTENDEE;PARTSTAT=ACCEPTED:mailto:north@example.test
ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:owner@example.test`);
const ExpectedMeeting = { title: "Planning", start: iso(13, 13), end: iso(13, 14), room: "Room North", reply: "pending" };
const settings = () => ({ url: Url, rooms: ["north@example.test=Room North"] });
const response = (body = calendar(Meeting)) => new Response(body);

beforeEach(() => {
    vi.mocked(readFileSync).mockReset().mockImplementation(() => {
        throw new Error("Unexpected config access");
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected network access")));
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("createCalendarFeed", () => {
    test("construction performs no config read or fetch, including with defaults", () => {
        const loadSettings = vi.fn(settings);
        const fetch = vi.fn();
        createCalendarFeed();
        createCalendarFeed({ loadSettings, fetch });
        expect(readFileSync).not.toHaveBeenCalled();
        expect(loadSettings).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    test("returns mapped rooms and replies through the real parser without call links", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response());
        const feed = createCalendarFeed({ loadSettings: settings, fetch, now: () => Now });
        expect(await feed.read()).toEqual({ meetings: [ExpectedMeeting], updatedAt: Now });
        expect(fetch).toHaveBeenCalledWith(Url, expect.objectContaining({ signal: expect.any(AbortSignal) }));
        expect(JSON.stringify(await feed.read())).not.toMatch(/https:|synthetic-call|url/);
    });

    test("keeps a plain location, tentative replies and meetings with no optional fields", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(calendar(
            event("Later", "20261113T160000", "20261113T163000"),
            event("Maybe", "20261113T150000", "20261113T153000", "LOCATION:Room South\nATTENDEE;PARTSTAT=TENTATIVE:mailto:owner@example.test")
        )));
        expect(await createCalendarFeed({ loadSettings: settings, fetch, now: () => Now }).read()).toEqual({
            meetings: [
                { title: "Maybe", start: iso(13, 15), end: iso(13, 15, 30), room: "Room South", reply: "tentative" },
                { title: "Later", start: iso(13, 16), end: iso(13, 16, 30) },
            ],
            updatedAt: Now,
        });
    });

    test("bounds the feed to fourteen local calendar days in start order", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(calendar(
            event("Outside", "20261127T000000", "20261127T010000"),
            event("Last day", "20261126T233000", "20261127T000000"),
            event("Next Monday", "20261116T090000", "20261116T100000"),
            event("Tomorrow", "20261114T233000", "20261115T000000"),
            event("Today", "20261113T000000", "20261113T003000"),
            event("Overnight", "20261112T233000", "20261113T003000"),
            event("Ended yesterday", "20261112T230000", "20261113T000000"),
            event("Cancelled", "20261113T130000", "20261113T140000", "STATUS:CANCELLED"),
            event("Declined", "20261113T140000", "20261113T150000", "ATTENDEE;PARTSTAT=DECLINED:mailto:owner@example.test"),
            "BEGIN:VEVENT\nUID:all-day\nDTSTART;VALUE=DATE:20261113\nDTEND;VALUE=DATE:20261114\nEND:VEVENT"
        )));
        const view = await createCalendarFeed({ loadSettings: settings, fetch, now: () => Now }).read();
        expect(view.meetings.map((meeting) => meeting.title)).toEqual(["Overnight", "Today", "Tomorrow", "Next Monday", "Last day"]);
    });

    test("Friday afternoon expands recurring meetings through next Monday and Tuesday", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(calendar(
            event("Weekly", "20261102T090000", "20261102T100000", "RRULE:FREQ=WEEKLY;BYDAY=MO,TU\nLOCATION:Room North")
        )));
        const view = await createCalendarFeed({ loadSettings: settings, fetch, now: () => Now }).read();
        expect(view.meetings.slice(0, 2)).toEqual([
            { title: "Weekly", start: iso(16, 9), end: iso(16, 10), room: "Room North" },
            { title: "Weekly", start: iso(17, 9), end: iso(17, 10), room: "Room North" },
        ]);
    });

    test("recurrence expansion failure retains the caller's successful cache and recovers", async () => {
        let clock = Now;
        const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => response());
        const feed = createCalendarFeed({ loadSettings: settings, fetch, now: () => clock });
        const good = await feed.read();
        clock += 60_000;
        fetch.mockResolvedValueOnce(response(calendar(
            event("Broken recurrence", "20261113T130000", "20261113T140000", "RRULE:FREQ=WEEKLY;BYMONTHDAY=13"),
            Meeting
        )));
        expect(await feed.read()).toEqual({ ...good, error: "Calendar unavailable" });
        expect(await feed.read()).toEqual({ ...good, error: "Calendar unavailable" });
        expect(fetch).toHaveBeenCalledTimes(2);
        clock += 60_000;
        expect(await feed.read()).toEqual({ meetings: [ExpectedMeeting], updatedAt: clock });
    });

    test("caches a successful read for 60 seconds and refreshes at expiry", async () => {
        let clock = Now;
        const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => response());
        const loadSettings = vi.fn(settings);
        const feed = createCalendarFeed({ loadSettings, fetch, now: () => clock });
        await feed.read();
        clock += 59_999;
        expect((await feed.read()).updatedAt).toBe(Now);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(loadSettings).toHaveBeenCalledTimes(1);
        clock++;
        expect((await feed.read()).updatedAt).toBe(clock);
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(loadSettings).toHaveBeenCalledTimes(2);
    });

    test("concurrent reads share the same fetch until the response body is consumed", async () => {
        let finish!: (text: string) => void;
        const text = new Promise<string>((resolve) => { finish = resolve; });
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue({ ok: true, text: () => text } as Response);
        const feed = createCalendarFeed({ loadSettings: settings, fetch, now: () => Now });
        const first = feed.read();
        await Promise.resolve();
        const second = feed.read();
        finish(calendar(Meeting));
        expect(await Promise.all([first, second])).toEqual([
            { meetings: [ExpectedMeeting], updatedAt: Now },
            { meetings: [ExpectedMeeting], updatedAt: Now },
        ]);
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    test("timestamps and caches from completion rather than a slow request's start", async () => {
        let clock = Now;
        const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => {
            clock += 90_000;
            return response();
        });
        const feed = createCalendarFeed({ loadSettings: settings, fetch, now: () => clock });
        expect((await feed.read()).updatedAt).toBe(Now + 90_000);
        expect((await feed.read()).updatedAt).toBe(Now + 90_000);
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    test("a valid empty calendar is a successful cached result", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => response(calendar()));
        const feed = createCalendarFeed({ loadSettings: settings, fetch, now: () => Now });
        expect(await feed.read()).toEqual({ meetings: [], updatedAt: Now });
        expect(await feed.read()).toEqual({ meetings: [], updatedAt: Now });
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    test.each(["", "not a calendar", "BEGIN:VCALENDAR\nnonsense", "BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR\n<html>failure</html>", calendar("BEGIN:VEVENT\nUID:broken\nEND:VEVENT")])(
        "malformed feed %# reports an error instead of a successful empty calendar", async (body) => {
            const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(body));
            const view = await createCalendarFeed({ loadSettings: settings, fetch, now: () => Now }).read();
            expect(view.meetings).toEqual([]);
            expect(view.updatedAt).toBeUndefined();
            expect(view.error).toEqual(expect.any(String));
            expect(view.error).not.toMatch(/https:|private|synthetic/);
        }
    );

    test.each(["network", "http", "body", "malformed", "settings", "missing"])(
        "%s failure retains the last good view, caches the error and recovers", async (failure) => {
            let clock = Now;
            const loadSettings = vi.fn(settings);
            const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => response());
            const feed = createCalendarFeed({ loadSettings, fetch, now: () => clock });
            const good = await feed.read();
            clock += 60_000;
            const secretError = new Error(`Failure for ${Url}`);
            if (failure === "network") fetch.mockRejectedValueOnce(secretError);
            if (failure === "http") fetch.mockResolvedValueOnce(new Response(Url, { status: 503, statusText: Url }));
            if (failure === "body") fetch.mockResolvedValueOnce({ ok: true, text: async () => { throw secretError; } } as unknown as Response);
            if (failure === "malformed") fetch.mockResolvedValueOnce(response("broken"));
            if (failure === "settings") loadSettings.mockImplementationOnce(() => { throw secretError; });
            if (failure === "missing") loadSettings.mockReturnValueOnce({ url: undefined, rooms: [] });
            const stale = await feed.read();
            expect(stale).toEqual({ ...good, error: expect.any(String) });
            expect(JSON.stringify(stale)).not.toMatch(/https:|private|synthetic/);
            const calls = fetch.mock.calls.length;
            expect(await feed.read()).toEqual(stale);
            expect(fetch).toHaveBeenCalledTimes(calls);
            clock += 60_000;
            expect(await feed.read()).toEqual({ meetings: [ExpectedMeeting], updatedAt: clock });
        }
    );

    test.each([undefined, "", "   "])("missing setting %j does not fetch and has no success timestamp", async (url) => {
        const fetch = vi.fn<typeof globalThis.fetch>();
        const view = await createCalendarFeed({ loadSettings: () => ({ url }), fetch, now: () => Now }).read();
        expect(view).toEqual({ meetings: [], error: expect.any(String) });
        expect(fetch).not.toHaveBeenCalled();
    });

    test("a failed initial request releases the shared request for a later retry", async () => {
        let clock = Now;
        const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValueOnce(new Error(Url)).mockResolvedValueOnce(response());
        const feed = createCalendarFeed({ loadSettings: settings, fetch, now: () => clock });
        const failed = await Promise.all([feed.read(), feed.read()]);
        expect(failed[0]).toEqual({ meetings: [], error: expect.any(String) });
        expect(failed[1]).toEqual(failed[0]);
        expect(fetch).toHaveBeenCalledTimes(1);
        clock += 60_000;
        expect((await feed.read()).meetings).toEqual([ExpectedMeeting]);
        expect(fetch).toHaveBeenCalledTimes(2);
    });
});

describe("default calendar settings", () => {
    test("reads only literal allowlisted assignments from the private config on first read", async () => {
        vi.mocked(readFileSync).mockReturnValue(`export WINTOS_CALENDAR_ICS='${Url}'
WINTOS_ROOMS="north@example.test=Room North, south@example.test=Room South"
UNRELATED="unterminated
WINTOS_CALENDAR_ICS_EXTRA='https://wrong.example.test'
echo WINTOS_CALENDAR_ICS='https://wrong.example.test'
WINTOS_ROOT=$(do-not-execute)
`);
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response());
        vi.stubGlobal("fetch", fetch);
        const feed = createCalendarFeed({ now: () => Now });
        expect(readFileSync).not.toHaveBeenCalled();
        expect(await feed.read()).toEqual({ meetings: [ExpectedMeeting], updatedAt: Now });
        expect(readFileSync).toHaveBeenCalledWith(join(homedir(), ".config/wintos/env"), "utf8");
        expect(fetch).toHaveBeenCalledWith(Url, expect.anything());
    });

    test("shell syntax remains literal and is never expanded", async () => {
        const literal = "$(do-not-execute)`do-not-execute`$HOME/${UNRELATED}";
        vi.mocked(readFileSync).mockReturnValue(`WINTOS_CALENDAR_ICS='${literal}'\nWINTOS_ROOMS='north@example.test=Room $HOME'`);
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response());
        const view = await createCalendarFeed({ fetch, now: () => Now }).read();
        expect(fetch).toHaveBeenCalledWith(literal, expect.anything());
        expect(view.meetings[0].room).toBe("Room $HOME");
    });

    test("config without a URL reports unavailable without a network call", async () => {
        vi.mocked(readFileSync).mockReturnValue("WINTOS_ROOMS=''\nUNRELATED=synthetic");
        const view = await createCalendarFeed({ now: () => Now }).read();
        expect(view).toEqual({ meetings: [], error: expect.any(String) });
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    test("config without rooms still returns meetings without a guessed location", async () => {
        vi.mocked(readFileSync).mockReturnValue(`WINTOS_CALENDAR_ICS="${Url}"`);
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response());
        const view = await createCalendarFeed({ fetch, now: () => Now }).read();
        expect(view.meetings).toEqual([{ title: "Planning", start: iso(13, 13), end: iso(13, 14), reply: "pending" }]);
    });

    test("private config read errors never expose the underlying error", async () => {
        vi.mocked(readFileSync).mockImplementation(() => { throw new Error(`Cannot read ${Url}`); });
        const view = await createCalendarFeed({ now: () => Now }).read();
        expect(view).toEqual({ meetings: [], error: expect.any(String) });
        expect(JSON.stringify(view)).not.toMatch(/https:|private|synthetic/);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });
});
