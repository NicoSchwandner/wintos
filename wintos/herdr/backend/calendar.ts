import ICAL from "ical.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { meetingsOf } from "@/wintos/plugins/calendar/parse";

export type CalendarMeeting = { title: string; start: string; end: string; room?: string; reply?: "pending" | "tentative" };
export type CalendarView = { meetings: CalendarMeeting[]; updatedAt?: number; error?: string };
type CalendarSettings = { url?: string; rooms?: string[] };
type CalendarOptions = { loadSettings?: () => CalendarSettings; fetch?: typeof fetch; now?: () => number };

const CacheMs = 60_000;
const FetchTimeoutMs = 30_000;

function loadCalendarSettings(): CalendarSettings {
    const assignments = readFileSync(join(homedir(), ".config/wintos/env"), "utf8")
        .split(/\r?\n/)
        .filter((line) => /^\s*(?:export\s+)?WINTOS_(CALENDAR_ICS|ROOMS)\s*=/.test(line))
        .join("\n");
    const settings = parseEnv(assignments);
    return {
        url: settings.WINTOS_CALENDAR_ICS,
        rooms: settings.WINTOS_ROOMS?.split(",").map((room) => room.trim()).filter(Boolean),
    };
}

function validateCalendar(text: string) {
    // The shared parser swallows invalid feeds; an outage must not erase the last good view.
    if (!/^BEGIN:VCALENDAR\r?\n[\s\S]*\r?\nEND:VCALENDAR$/i.test(text.trim())) throw new Error("Invalid calendar");
    const calendar = new ICAL.Component(ICAL.parse(text));
    if (calendar.name !== "vcalendar") throw new Error("Invalid calendar");
    for (const component of calendar.getAllSubcomponents("vevent")) {
        const event = new ICAL.Event(component);
        if (!Number.isFinite(event.startDate?.toJSDate().getTime()) || !Number.isFinite(event.endDate?.toJSDate().getTime()))
            throw new Error("Invalid calendar");
    }
    return calendar;
}

export function createCalendarFeed(options: CalendarOptions = {}): { read(): Promise<CalendarView> } {
    const loadSettings = options.loadSettings ?? loadCalendarSettings;
    const fetchCalendar = options.fetch ?? globalThis.fetch;
    const now = options.now ?? Date.now;
    let view: CalendarView = { meetings: [] };
    let nextReadAt = -Infinity;
    let inFlight: Promise<CalendarView> | undefined;

    async function refresh(): Promise<CalendarView> {
        try {
            const settings = loadSettings();
            if (!settings.url?.trim()) return { ...view, error: "Calendar is not configured" };
            const response = await fetchCalendar(settings.url, { signal: AbortSignal.timeout(FetchTimeoutMs) });
            if (!response.ok) throw new Error("Calendar unavailable");
            const text = await response.text();
            const calendar = validateCalendar(text);
            const from = new Date(now());
            from.setHours(0, 0, 0, 0);
            const to = new Date(from);
            to.setDate(to.getDate() + 14);
            const meetings = meetingsOf(calendar, from.getTime(), to.getTime(), { rooms: settings.rooms }).map(
                ({ title, start, end, room, reply }): CalendarMeeting => ({
                    title,
                    start,
                    end,
                    ...(room ? { room } : {}),
                    ...(reply ? { reply } : {}),
                })
            );
            return { meetings, updatedAt: now() };
        } catch {
            return { ...view, error: "Calendar unavailable" };
        }
    }

    return {
        read() {
            if (inFlight) return inFlight;
            if (now() < nextReadAt) return Promise.resolve(view);
            inFlight = refresh()
                .then((result) => {
                    view = result;
                    nextReadAt = now() + CacheMs;
                    return view;
                })
                .finally(() => { inFlight = undefined; });
            return inFlight;
        },
    };
}
