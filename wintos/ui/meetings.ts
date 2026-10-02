// Meetings come from any plugin that reports `meetings: [{ title, start, end, url? }]` (ISO
// times), so the calendar source can change without the sidebar knowing.
export type Meeting = { title: string; start: number; end: number; url?: string };
export const WARN_MS = 2 * 60_000;

type Raw = { title?: unknown; start?: unknown; end?: unknown; url?: unknown; allDay?: unknown };

export function meetingsFrom(plugins: Record<string, { ok?: boolean; at?: number; data?: unknown }> = {}): Meeting[] {
    const out: Meeting[] = [];
    for (const r of Object.values(plugins)) {
        const list = (r.data as { meetings?: Raw[] } | undefined)?.meetings;
        if (!Array.isArray(list)) continue;
        for (const x of list) {
            const start = typeof x?.start === "string" ? Date.parse(x.start) : NaN;
            const end = typeof x?.end === "string" ? Date.parse(x.end) : NaN;
            if (typeof x?.title !== "string" || !(end > start) || x.allDay === true) continue;
            out.push({ title: x.title, start, end, ...(typeof x.url === "string" && /^https?:\/\//.test(x.url) ? { url: x.url } : {}) });
        }
    }
    return out.sort((a, b) => a.start - b.start);
}

// Today's, by the local clock: the one on now, the next to start and the one after it. soon: the
// next starts within WARN_MS, which is when the card and the window's edge warn.
export function nextMeetings(list: Meeting[], now: number): { now?: Meeting; next?: Meeting; after?: Meeting; msLeft?: number; soon: boolean } {
    const day = new Date(now).toDateString();
    const today = list.filter((m) => new Date(m.start).toDateString() === day);
    const upcoming = today.filter((m) => m.start > now);
    const next = upcoming[0];
    const msLeft = next ? next.start - now : undefined;
    return { now: today.find((m) => m.start <= now && now < m.end), next, after: upcoming[1], msLeft, soon: msLeft !== undefined && msLeft <= WARN_MS };
}

// The renderer's latest list, for ⇧⌘M: join the one on now, else the next.
let latest: Meeting[] = [];
export const setLatestMeetings = (list: Meeting[]) => (latest = list);
export function meetingToJoin(now: number): Meeting | undefined {
    const n = nextMeetings(latest, now);
    return n.now?.url ? n.now : n.next?.url ? n.next : undefined;
}

export const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
export function countdown(ms: number): string {
    if (ms <= WARN_MS) {
        const s = Math.max(0, Math.ceil(ms / 1000));
        return `in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    }
    const min = Math.ceil(ms / 60_000);
    return min < 60 ? `in ${min} min` : `in ${Math.floor(min / 60)} h ${min % 60} min`;
}
