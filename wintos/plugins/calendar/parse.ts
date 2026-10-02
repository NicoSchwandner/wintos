import ICAL from "ical.js";

export type IcsMeeting = { title: string; start: string; end: string; url?: string; allDay?: boolean };

// A call link in the event: Google's own property first, else the first known one in the text.
const CALL = /https:\/\/(?:meet\.google\.com|[\w.-]*zoom\.us|teams\.microsoft\.com)\/[^\s<>"\\]+/;
function callUrl(item: ICAL.Event): string | undefined {
    const google = item.component.getFirstPropertyValue("x-google-conference");
    if (typeof google === "string" && google.startsWith("https://")) return google;
    return CALL.exec(`${item.description ?? ""} ${item.location ?? ""}`)?.[0];
}

// The calendar's owner, as Google names a primary calendar's feed after its address.
function declinedBy(item: ICAL.Event, me: string | undefined): boolean {
    if (!me) return false;
    return item.component.getAllProperties("attendee").some((a) => String(a.getFirstValue()).toLowerCase() === `mailto:${me}` && String(a.getParameter("partstat")).toUpperCase() === "DECLINED");
}

// The meetings of an iCal feed that overlap [from, to), recurring ones expanded with their
// skipped and moved occurrences; declined and cancelled ones left out.
export function icsToMeetings(text: string, from: number, to: number, opts: { keepAllDay?: boolean } = {}): IcsMeeting[] {
    try {
        return meetingsOf(new ICAL.Component(ICAL.parse(text)), from, to, opts);
    } catch {
        return []; // a broken feed reads as no meetings, never as a crashed plugin
    }
}

function meetingsOf(cal: ICAL.Component, from: number, to: number, opts: { keepAllDay?: boolean }): IcsMeeting[] {
    for (const tz of cal.getAllSubcomponents("vtimezone")) ICAL.TimezoneService.register(tz);
    const name = cal.getFirstPropertyValue("x-wr-calname");
    const me = typeof name === "string" && name.includes("@") ? name.toLowerCase() : undefined;

    const events = cal.getAllSubcomponents("vevent").map((v) => new ICAL.Event(v));
    const masters = new Map<string, ICAL.Event>();
    for (const e of events) if (!e.isRecurrenceException()) masters.set(e.uid, e);
    for (const e of events) if (e.isRecurrenceException()) masters.get(e.uid)?.relateException(e);

    const out: IcsMeeting[] = [];
    // series: a moved occurrence that names no call of its own keeps the series' one.
    const add = (item: ICAL.Event, start: ICAL.Time, end: ICAL.Time, series = item) => {
        const s = start.toJSDate().getTime();
        const e = end.toJSDate().getTime();
        if (e <= from || s >= to) return;
        if (String(item.component.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED" || declinedBy(item, me)) return;
        if (start.isDate && !opts.keepAllDay) return;
        const url = callUrl(item) ?? callUrl(series);
        out.push({ title: item.summary || "(no title)", start: new Date(s).toISOString(), end: new Date(e).toISOString(), ...(url ? { url } : {}), ...(start.isDate ? { allDay: true } : {}) });
    };
    for (const master of masters.values()) {
        if (!master.isRecurring()) {
            add(master, master.startDate, master.endDate);
            continue;
        }
        const it = master.iterator();
        // ponytail: walks from the series' first date; fine for years of weekly meetings, a
        // DTSTART-to-window skip if a feed ever holds decades of minutely ones.
        for (let t = it.next(), n = 0; t && n < 100_000; t = it.next(), n++) {
            if (t.toJSDate().getTime() >= to) break;
            const d = master.getOccurrenceDetails(t);
            add(d.item, d.startDate, d.endDate, master);
        }
    }
    return out.sort((a, b) => a.start.localeCompare(b.start));
}
