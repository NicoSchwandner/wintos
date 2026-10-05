import { toggleCheckbox } from "./notes/checkbox";
import type { SaveResult } from "./notes/useNotes";
import { daemonFetch } from "./useWintos";
import type { Day } from "../daemon/journal/journal";
import { focusList } from "./dayplan";

// Today's focus lives in the day's journal file; wintosd writes it, refusing a save based on
// an older file. Planning a day (⌘⏎ on the Today page) stops the card's orange pulse.
export async function saveFocus(text: string, baseMtime: number): Promise<SaveResult> {
    try {
        const r = await daemonFetch("/day/focus", { method: "POST", body: { text, baseMtime } });
        return r.ok ? "ok" : r.status === 409 ? "conflict" : "error";
    } catch {
        return "error";
    }
}
export const markPlanned = () => daemonFetch("/day/planned", { method: "POST", body: {} }).catch(() => undefined);
export const tickFocus = (day: Day, line: number) => saveFocus(toggleCheckbox(day.focus, line), day.mtime);
export const carryToToday = (day: Day, item: string) => saveFocus(`${day.focus}\n- [ ] ${item}`.trim(), day.mtime);

// Everything the earlier day planned: its focus items, ticked or not, then its goals for
// tomorrow; each marked carried once it is in today's focus. Carrying copies, so nothing leaves.
export function yesterdayItems(day: Day): { text: string; done: boolean; carried: boolean }[] {
    const y = day.yesterday;
    if (!y) return [];
    const today = new Set(focusList(day.focus).map((i) => i.text));
    const seen = new Set<string>();
    return [...focusList(y.focus), ...focusList(y.tomorrow.join("\n"))]
        .filter((i) => !seen.has(i.text) && seen.add(i.text))
        .map((i) => ({ text: i.text, done: i.done, carried: today.has(i.text) }));
}

// What it left open and today doesn't have yet.
export const leftFromYesterday = (day: Day): string[] => yesterdayItems(day).filter((i) => !i.done && !i.carried).map((i) => i.text);

// What to call the day the plan builds on: "Yesterday" only when it was, its weekday within the
// week, "Last Friday" across a weekend, else its date.
export function lastDayName(lastIso: string, todayIso: string): string {
    const last = new Date(`${lastIso}T12:00:00`);
    const today = new Date(`${todayIso}T12:00:00`);
    const days = Math.round((today.getTime() - last.getTime()) / 86_400_000);
    const weekday = last.toLocaleDateString("en-GB", { weekday: "long" });
    const monday = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();
    if (days === 1) return "Yesterday";
    if (monday(last) === monday(today)) return weekday;
    if (days < 7) return `Last ${weekday}`;
    return last.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
}
