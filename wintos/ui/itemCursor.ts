import type { KeyTable } from "./zones";
import { motionKeys } from "./listMotion";

// A keyboard cursor over what can be acted on in the notes and on the Today page: task boxes
// (x ticks), heads-ups (x closes), links (⏎ opens), yesterday's open items (c carries into today) and the daily's
// items while you curate them (x drops, p lifts to the top, ⏎ rewrites). Items are found
// by data-item in the zone, in reading order; the cursor is marked with data-cursor. The action
// is the item's own click, so the key does exactly what the mouse would.
const marked = new WeakMap<HTMLElement, number>();
const items = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>("[data-item]")];

// The notes redraw often (every score change re-renders them, and markdown builds its elements
// afresh), which drops the mark; the cursor is kept as an index and the mark put back.
const watched = new WeakSet<HTMLElement>();
function paint(root: HTMLElement): void {
    const at = marked.get(root);
    const target = at === undefined ? undefined : items(root)[at];
    // Also an element that stopped being an item (a carried row) keeps no mark.
    root.querySelectorAll("[data-cursor]").forEach((el) => el !== target && el.removeAttribute("data-cursor"));
    if (target && !target.hasAttribute("data-cursor")) target.setAttribute("data-cursor", "");
}
function watch(root: HTMLElement): void {
    if (watched.has(root)) return;
    watched.add(root);
    new MutationObserver(() => paint(root)).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-item"] });
}

function move(root: HTMLElement, delta: number): boolean {
    const list = items(root);
    if (!list.length) return false;
    const at = marked.get(root) ?? -1;
    const next = !Number.isFinite(delta) ? (delta > 0 ? list.length - 1 : 0) : Math.max(0, Math.min(list.length - 1, at < 0 ? (delta > 0 ? 0 : list.length - 1) : at + delta));
    marked.set(root, next);
    watch(root);
    paint(root);
    list[next].scrollIntoView({ block: "nearest" });
    return true;
}

// Puts the cursor on the first item that matches (an open task: ticking is what you came for).
export function startCursor(root: HTMLElement, match: (el: HTMLElement) => boolean): void {
    const i = items(root).findIndex(match);
    if (i < 0) return;
    marked.set(root, i);
    watch(root);
    paint(root);
}

// The item under the cursor, if it is of this kind; its clickable part is itself or the first
// [data-act] inside it (a task's box, a row's carry button), or the one named by part.
function act(root: HTMLElement, kind: string, part_?: string): boolean {
    const at = marked.get(root);
    const el = at === undefined ? undefined : items(root)[at];
    if (!el || el.dataset.item !== kind) return false;
    const part = el.querySelector<HTMLElement>(part_ ?? "[data-act]") ?? el;
    (part.matches("button, a") ? part : (part.querySelector<HTMLElement>("button, a") ?? part)).click();
    return true;
}

export const cursorKeys = (root: () => HTMLElement | null): KeyTable => {
    const on = (f: (r: HTMLElement) => boolean) => () => {
        const r = root();
        return r ? f(r) : false;
    };
    return {
        ...motionKeys(
            (by) => void on((r) => move(r, by))(),
            (end) => void on((r) => move(r, end === "first" ? -Infinity : Infinity))(),
        ),
        j: on((r) => move(r, 1)),
        k: on((r) => move(r, -1)),
        x: on((r) => act(r, "check") || act(r, "headsup") || act(r, "standup", "[data-drop]")),
        c: on((r) => act(r, "carry")),
        p: on((r) => act(r, "standup", "[data-top]")),
        Enter: on((r) => act(r, "link") || act(r, "standup", "[data-rewrite]")),
        // m unfolds every folded list in view (yesterday's items, the daily), or folds
        // them all back when none is folded.
        m: on((r) => {
            const closed = [...r.querySelectorAll<HTMLElement>("[data-more=closed]")];
            const all = closed.length ? closed : [...r.querySelectorAll<HTMLElement>("[data-more=open]")];
            all.forEach((b) => b.click());
            return all.length > 0;
        }),
    };
};
