import type { PR } from "../daemon/prs/group";

// A driving project's day in numbers: the drive board on Today, the wrap-up and its sidebar card.
export type DriveDay = { prompts: number; waitedMs: number; opened: number; merged: number };
export function driveDay(today: { prompts: number; waitedMs: number } | undefined, prs: PR[], me: string | undefined, now: number): DriveDay {
    const day = new Date(now).toDateString();
    const on = (t?: string) => !!t && new Date(t).toDateString() === day;
    const mine = prs.filter((p) => p.author === me);
    return { prompts: today?.prompts ?? 0, waitedMs: today?.waitedMs ?? 0, opened: mine.filter((p) => on(p.createdAt)).length, merged: mine.filter((p) => on(p.mergedAt)).length };
}

const duration = (ms: number) => {
    const min = Math.round(ms / 60_000);
    return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${String(min % 60).padStart(2, "0")}` : ""}`;
};
export function driveDayLine(d: DriveDay): string {
    const prs = [d.opened && `${d.opened} PR${d.opened === 1 ? "" : "s"} opened`, d.merged && `${d.merged} merged`].filter(Boolean);
    return [`${d.prompts} prompt${d.prompts === 1 ? "" : "s"}`, ...prs, d.waitedMs >= 60_000 ? `waited ${duration(d.waitedMs)} on you` : ""].filter(Boolean).join(" · ");
}
