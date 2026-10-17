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
export const carryToToday = (day: Day, chain: Carried[]) => saveFocus(withCarried(day.focus, chain), day.mtime);

type Carried = { text: string; depth: number };
const indentOf = (l: string) => (l.trim() ? Math.floor((/^\s*/.exec(l)![0].replace(/\t/g, "  ").length) / 2) : -1);
// Today's focus with an item carried in at its depth. chain: the item's parents, then the item,
// as yesterday had them. A parent today already has takes the item under it; one it lacks comes
// along, so a sub-item never lands under whatever today happens to end with.
export function withCarried(focus: string, chain: Carried[]): string {
    const lines = focus.trim() ? focus.split("\n") : [];
    const end = (i: number) => {
        let j = i + 1;
        while (j < lines.length && indentOf(lines[j]) > indentOf(lines[i])) j++;
        return j;
    };
    let parent = -1;
    for (const node of chain) {
        const from = parent + 1;
        const to = parent < 0 ? lines.length : end(parent);
        const found = focusList(lines.slice(from, to).join("\n")).find((i) => i.text === node.text && (parent < 0 ? i.depth === 0 : i.depth === indentOf(lines[parent]) + 1));
        if (found) {
            parent = from + found.line;
            continue;
        }
        const depth = parent < 0 ? 0 : indentOf(lines[parent]) + 1;
        lines.splice(to, 0, `${"  ".repeat(depth)}- [ ] ${node.text}`);
        parent = to;
    }
    return lines.join("\n");
}

// Everything the earlier day planned: its focus items, ticked or not, then its goals for
// tomorrow; each marked carried once it is in today's focus. Carrying copies, so nothing leaves.
export function yesterdayItems(day: Day): { text: string; done: boolean; carried: boolean; depth: number; chain: Carried[] }[] {
    const y = day.yesterday;
    if (!y) return [];
    const today = new Set(focusList(day.focus).map((i) => i.text));
    const seen = new Set<string>();
    const chains = (list: ReturnType<typeof focusList>) =>
        list.map((item, k) => {
            const chain: Carried[] = [item];
            for (let j = k - 1; j >= 0 && chain[0].depth > 0; j--) if (list[j].depth < chain[0].depth) chain.unshift(list[j]);
            return { ...item, chain: chain.map(({ text, depth }) => ({ text, depth })) };
        });
    return [...chains(focusList(y.focus)), ...chains(focusList(y.tomorrow.join("\n")))]
        .filter((i) => !seen.has(i.text) && seen.add(i.text))
        .map((i) => ({ text: i.text, done: i.done, carried: today.has(i.text), depth: i.depth, chain: i.chain }));
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
