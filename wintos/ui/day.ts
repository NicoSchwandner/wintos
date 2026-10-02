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

// What yesterday left open: its unticked focus items, then its goals for tomorrow.
export function leftFromYesterday(day: Day): string[] {
    const y = day.yesterday;
    if (!y) return [];
    const open = focusList(y.focus).filter((i) => !i.done).map((i) => i.text);
    const goals = focusList(y.tomorrow.join("\n")).filter((i) => !i.done).map((i) => i.text);
    const today = new Set(focusList(day.focus).map((i) => i.text));
    return [...new Set([...open, ...goals])].filter((t) => !today.has(t));
}
