import { meetingsFrom, nextMeetings } from "../ui/meetings";

const Weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const Months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type CalendarView = {
    meetings: { title: string; start: string; end: string; room?: string; reply?: "pending" | "tentative" }[];
    updatedAt?: number;
    error?: string;
};

export function meetingRows(
    data: CalendarView,
    now: number
): { title: string; time: string; room: string; unaccepted?: boolean }[] {
    const list = meetingsFrom({ calendar: { data } });
    const selection = nextMeetings(list, now);
    const current = list
        .filter((meeting) => meeting.start <= now && now < meeting.end)
        .sort((a, b) => Number(!!a.unaccepted) - Number(!!b.unaccepted))[0];
    const first = current && !selection.soon ? current : selection.next;
    const second = first === current ? selection.next : selection.after;
    const shown = first ? [first] : [];
    if (second) shown.push(second);

    const tomorrow = new Date(now);
    tomorrow.setHours(0, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const future = list
        .filter((meeting) => meeting.start >= tomorrow.getTime())
        .sort((a, b) => a.start - b.start || Number(!!a.unaccepted) - Number(!!b.unaccepted));
    for (const meeting of future) {
        if (shown.length === 2) break;
        if (!shown.some((row) => row.start === meeting.start)) shown.push(meeting);
    }
    return shown.map((meeting) => ({
        title: meeting.title,
        time: `${dayLabel(meeting.start, now)}${localTime(meeting.start)} – ${localTime(meeting.end)}`,
        room: meeting.room?.trim() || "Room not listed",
        ...(meeting.unaccepted ? { unaccepted: true } : {}),
    }));
}

function localTime(time: number): string {
    const date = new Date(time);
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function dayLabel(start: number, now: number): string {
    const day = new Date(start);
    const today = new Date(now);
    if (day.toDateString() === today.toDateString()) return "";
    today.setDate(today.getDate() + 1);
    if (day.toDateString() === today.toDateString()) return "Tomorrow · ";
    return `${Weekdays[day.getDay()]} ${day.getDate()} ${Months[day.getMonth()]} · `;
}
