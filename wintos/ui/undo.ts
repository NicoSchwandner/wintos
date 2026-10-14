// ⌘Z: what WintOS last put away, newest first. Every tab's renderer shares it (localStorage),
// since putting a project away lands you in another tab, where ⌘Z is pressed.
export type UndoItem = (
    | { kind: "pane"; tabId: string; meta: MetaType }
    | { kind: "project"; projectId: string; metas: MetaType[] }
    | { kind: "park"; sessionId: string }
    | { kind: "pr-snooze"; url: string }
) & { label: string };
export type Undo = UndoItem & { at: number };

const KEY = "wintos:undo";
export const UNDO_MAX = 10;
// ponytail: an age, not "this run of WintOS": nothing marks a run across renderers.
export const UNDO_TTL_MS = 30 * 60_000;
export const UNDO_EVENT = "wintos-undo";

export const pushed = (stack: Undo[], item: Undo, now: number): Undo[] => [item, ...live(stack, now)].slice(0, UNDO_MAX);
export const live = (stack: Undo[], now: number): Undo[] => stack.filter((u) => now - u.at < UNDO_TTL_MS);

export function readUndo(): Undo[] {
    try {
        return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Undo[];
    } catch {
        return [];
    }
}
function write(stack: Undo[]): void {
    try {
        localStorage.setItem(KEY, JSON.stringify(stack));
    } catch {}
    window.dispatchEvent(new Event(UNDO_EVENT)); // the storage event reaches the other renderers only
}

export function rememberUndo(item: UndoItem): void {
    write(pushed(readUndo(), { ...item, at: Date.now() }, Date.now()));
}

export function takeUndo(): Undo | undefined {
    const [last, ...rest] = live(readUndo(), Date.now());
    write(rest);
    return last;
}
