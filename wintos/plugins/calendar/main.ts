// Core plugin: today's and tomorrow's meetings from a calendar's secret iCal address
// (WINTOS_CALENDAR_ICS), for the sidebar's meeting card and the two-minute warning.
// WINTOS_ROOMS: the meeting rooms, comma separated, each an address or "address=Name", to tell a booked room from a guest.
// The address is a secret: it is never printed, not even in an error.
import { icsToMeetings } from "./parse";

const url = process.env.WINTOS_CALENDAR_ICS;
if (!url) {
    process.stderr.write("WINTOS_CALENDAR_ICS is not set");
    process.exit(1);
}
const from = new Date();
from.setHours(0, 0, 0, 0);
const to = from.getTime() + 2 * 86_400_000;

fetch(url!, { signal: AbortSignal.timeout(30_000) })
    .then(async (res) => {
        if (!res.ok) throw new Error(`the calendar answered ${res.status}`);
        process.stdout.write(JSON.stringify({ meetings: icsToMeetings(await res.text(), from.getTime(), to, { rooms: process.env.WINTOS_ROOMS?.split(",").filter(Boolean) }) }));
    })
    .catch((e) => {
        process.stderr.write(`could not read the calendar: ${e instanceof Error && !e.message.includes("http") ? e.message : "request failed"}`);
        process.exit(1);
    });
