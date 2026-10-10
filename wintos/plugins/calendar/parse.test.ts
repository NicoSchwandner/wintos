import { describe, expect, test } from "vitest";
import { icsToMeetings } from "./parse";

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
X-WR-CALNAME:dev@example.com
BEGIN:VTIMEZONE
TZID:Europe/Stockholm
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:daily-1
SUMMARY:Daily
DTSTART;TZID=Europe/Stockholm:20260921T100000
DTEND;TZID=Europe/Stockholm:20260921T101500
RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR
EXDATE;TZID=Europe/Stockholm:20261001T100000
X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij
END:VEVENT
BEGIN:VEVENT
UID:daily-1
RECURRENCE-ID;TZID=Europe/Stockholm:20261002T100000
SUMMARY:Daily (moved)
DTSTART;TZID=Europe/Stockholm:20261002T110000
DTEND;TZID=Europe/Stockholm:20261002T111500
LOCATION:Kitchen
END:VEVENT
BEGIN:VEVENT
UID:refinement
SUMMARY:Refinement
DTSTART:20261002T113000Z
DTEND:20261002T121500Z
DESCRIPTION:Join with Google Meet: https://meet.google.com/xyz-uvwx-rst\\nAgenda
LOCATION:https://meet.google.com/xyz-uvwx-rst
ATTENDEE;CN=ana.b;PARTSTAT=ACCEPTED:mailto:ana.b@example.com
ATTENDEE;CN=bigroom;PARTSTAT=ACCEPTED:mailto:bigroom@example.com
END:VEVENT
BEGIN:VEVENT
UID:declined
SUMMARY:Optional sync
DTSTART:20261002T130000Z
DTEND:20261002T133000Z
ATTENDEE;PARTSTAT=DECLINED:mailto:dev@example.com
END:VEVENT
BEGIN:VEVENT
UID:holiday
SUMMARY:Holiday
DTSTART;VALUE=DATE:20261002
DTEND;VALUE=DATE:20261003
END:VEVENT
BEGIN:VEVENT
UID:cancelled
SUMMARY:Cancelled thing
STATUS:CANCELLED
DTSTART:20261002T140000Z
DTEND:20261002T143000Z
END:VEVENT
END:VCALENDAR`;

const FROM = Date.parse("2026-09-30T22:00:00Z"); // 1 oct 00:00 in Stockholm
const TO = Date.parse("2026-10-02T22:00:00Z");
const rows = () => icsToMeetings(ICS, FROM, TO).map((m) => [m.title, m.start, m.url ?? null]);

describe("icsToMeetings", () => {
    test("expands recurring meetings in the window, with their time zone, skipped days and moved ones", () =>
        expect(rows()).toEqual([
            ["Daily (moved)", "2026-10-02T09:00:00.000Z", "https://meet.google.com/abc-defg-hij"],
            ["Refinement", "2026-10-02T11:30:00.000Z", "https://meet.google.com/xyz-uvwx-rst"],
        ]));

    test("all-day events are kept but marked, so the sidebar can leave them out", () => {
        const all = icsToMeetings(ICS, FROM, TO, { keepAllDay: true });
        expect(all.find((m) => m.title === "Holiday")?.allDay).toBe(true);
    });

    test("the room: a booked room's account among the attendees, else a location that is no link", () => {
        const rooms = (r?: string[]) => icsToMeetings(ICS, FROM, TO, { rooms: r }).map((m) => [m.title, m.room ?? null]);
        expect(rooms(["BigRoom@example.com"])).toEqual([["Daily (moved)", "Kitchen"], ["Refinement", "Bigroom"]]);
        expect(rooms(["bigroom@example.com=Room (Big)"])).toEqual([["Daily (moved)", "Kitchen"], ["Refinement", "Room (Big)"]]);
        expect(rooms()).toEqual([["Daily (moved)", "Kitchen"], ["Refinement", null]]);
    });

    test("an empty or broken feed gives no meetings rather than throwing", () => {
        expect(icsToMeetings("", FROM, TO)).toEqual([]);
        expect(icsToMeetings("BEGIN:VCALENDAR\nnonsense", FROM, TO)).toEqual([]);
    });
});
