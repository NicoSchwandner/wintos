import type { KeyTable } from "./zones";

// A keyboard cursor over what can be acted on in the notes and on the Today page: task boxes
// (x ticks), links (⏎ opens) and yesterday's open items (c carries into today). Items are found
// by data-item in the zone, in reading order; the cursor is marked with data-cursor. The action
// is the item's own click, so the key does exactly what the mouse would.
const marked = new WeakMap<HTMLElement, number>();
const items = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>("[data-item]")];

// The notes redraw often (every score change re-renders them, and markdown builds its elements
// afresh), which drops the mark; the cursor is kept as an index and the mark put back.
const watched = new WeakSet<HTMLElement>();
function paint(root: HTMLElement): void {
    const at = marked.get(root);
    items(root).forEach((el, i) => {
        if (i === at && !el.hasAttribute("data-cursor")) el.setAttribute("data-cursor", "");
        if (i !== at && el.hasAttribute("data-cursor")) el.removeAttribute("data-cursor");
    });
}
function watch(root: HTMLElement): void {
    if (watched.has(root)) return;
    watched.add(root);
    new MutationObserver(() => paint(root)).observe(root, { childList: true, subtree: true });
}

function move(root: HTMLElement, delta: number): boolean {
    const list = items(root);
    if (!list.length) return false;
    const at = marked.get(root) ?? -1;
    const next = Math.max(0, Math.min(list.length - 1, at < 0 ? (delta > 0 ? 0 : list.length - 1) : at + delta));
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
// [data-act] inside it (a task's box, a row's carry button).
function act(root: HTMLElement, kind: string): boolean {
    const at = marked.get(root);
    const el = at === undefined ? undefined : items(root)[at];
    if (!el || el.dataset.item !== kind) return false;
    const part = el.querySelector<HTMLElement>("[data-act]") ?? el;
    (part.matches("button, a") ? part : (part.querySelector<HTMLElement>("button, a") ?? part)).click();
    return true;
}

export const cursorKeys = (root: () => HTMLElement | null): KeyTable => {
    const on = (f: (r: HTMLElement) => boolean) => () => {
        const r = root();
        return r ? f(r) : false;
    };
    return {
        j: on((r) => move(r, 1)),
        k: on((r) => move(r, -1)),
        x: on((r) => act(r, "check")),
        c: on((r) => act(r, "carry")),
        Enter: on((r) => act(r, "link")),
        // m unfolds every folded list in view (more decisions, ticked Built items), or folds
        // them all back when none is folded.
        m: on((r) => {
            const closed = [...r.querySelectorAll<HTMLElement>("[data-more=closed]")];
            const all = closed.length ? closed : [...r.querySelectorAll<HTMLElement>("[data-more=open]")];
            all.forEach((b) => b.click());
            return all.length > 0;
        }),
    };
};
