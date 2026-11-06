import type { IcsMeeting } from "./parse";

// The time you spent in meetings, for the month's project report: the meetings you accepted or
// made, all-day ones left out, and overlapping ones counted once.
export function meetingMs(meetings: IcsMeeting[]): number {
    const spans = meetings
        .filter((m) => !m.allDay && !m.reply)
        .map((m) => [Date.parse(m.start), Date.parse(m.end)] as const)
        .filter(([s, e]) => e > s)
        .sort((a, b) => a[0] - b[0]);
    let total = 0;
    let [from, to] = [-Infinity, -Infinity];
    for (const [s, e] of spans) {
        if (s > to) {
            if (to > from) total += to - from;
            [from, to] = [s, e];
        } else to = Math.max(to, e);
    }
    return to > from ? total + (to - from) : total;
}
