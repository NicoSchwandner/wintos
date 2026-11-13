import { meetingsFrom, nextMeetings } from "../ui/meetings";

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

    return shown.map((meeting) => ({
        title: meeting.title,
        time: `${localTime(meeting.start)} – ${localTime(meeting.end)}`,
        room: meeting.room?.trim() || "Room not listed",
        ...(meeting.unaccepted ? { unaccepted: true } : {}),
    }));
}

function localTime(time: number): string {
    const date = new Date(time);
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
