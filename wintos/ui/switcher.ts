import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";
import { enterProject, focusArea, whereYouAre } from "./focus";
import { goToInbox } from "./inbox";
import { openView } from "./menu";
import type { InboxList } from "./view";
import { flog } from "./focusLog";

// ⌘J / ⌘K work like ⌘⇥: hold ⌘ and tap to walk the ranked projects in this renderer's
// sidebar, release ⌘ to switch once. Walking without switching keeps the cursor in the one
// renderer that owns it (every Wave tab is its own renderer).
export const switchTargetAtom = atom(null as string | null);

let order: string[] = [];
export const setSwitchOrder = (tabIds: string[]) => (order = tabIds);
// Where closing a project lands: the uppermost project in the sidebar.
export const topProject = (closing: string) => order.find((id) => id !== closing);

export function stepProject(order: string[], current: string, delta: 1 | -1): string | undefined {
    if (!order.length) return undefined;
    const i = order.indexOf(current);
    if (i < 0) return delta > 0 ? order[0] : order[order.length - 1];
    return order[(i + delta + order.length) % order.length];
}

export function switchProject(delta: 1 | -1, cmdHeld: boolean): void {
    const next = stepProject(order, globalStore.get(switchTargetAtom) ?? whereYouAre(), delta);
    if (!next) return;
    globalStore.set(switchTargetAtom, next);
    if (!cmdHeld) return commit("menu");
    flog(`walk → ${next.slice(0, 6)}`);
    listen(true);
}

// A card opens what it shows; a project is entered, even the one you're in, so a page over it
// (Today) goes away.
function go(target: string | null): void {
    if (target === "card:prs" || target === "card:oncall") goToInbox(target.slice(5) as InboxList);
    else if (target === "card:today") openView("day");
    else if (target) enterProject(target);
    else focusArea("terminal");
}

function commit(why = "⌘ released"): void {
    const target = globalStore.get(switchTargetAtom);
    const from = whereYouAre();
    end(why);
    try {
        if (target && target !== from) localStorage.setItem(UNDO, JSON.stringify({ from, at: Date.now() }));
    } catch {} // no storage, no undo; the walk itself goes on
    go(target);
}

// macOS never hands Esc to an app while ⌘ is held, so a walk cannot be cancelled before it
// lands. Esc right after it lands takes it back instead. The walk ends in another tab, another
// renderer, so the way back travels in localStorage.
const UNDO = "wintos:walk-undo";
const UNDO_MS = 1500;
export function undoWalkKey(e: { key: string; cmd?: boolean; shift?: boolean; control?: boolean; alt?: boolean }): boolean {
    if (e.key !== "Escape" || e.cmd || e.shift || e.control || e.alt) return false;
    let rec: { from: string; at: number } | null = null;
    try {
        rec = JSON.parse(localStorage.getItem(UNDO) ?? "null");
        localStorage.removeItem(UNDO);
    } catch {}
    if (!rec?.from || Date.now() - rec.at > UNDO_MS) return false;
    flog(`walk undone (esc) → ${rec.from.slice(0, 9)}`);
    go(rec.from);
    return true;
}

function end(why: string): void {
    if (walking()) flog(`walk ended (${why})`);
    globalStore.set(switchTargetAtom, null);
    listen(false);
}

export const walking = () => globalStore.get(switchTargetAtom) != null;

// While walking only ⌘J/⌘K, Esc and the ⌘ release count: the walk chooses a project, so any
// other ⌘ key (⌘H/⌘L moving focus in the project you are leaving) is swallowed. A key without
// ⌘ means its release never reached us: the walk switches, and the key goes on.
export function walkKey(e: { cmd?: boolean; key: string }): boolean {
    if (!walking()) return false;
    if (e.key === "Escape") return end("esc"), true;
    if (!e.cmd) return commit("⌘ was already up"), false;
    return !["j", "k"].includes(e.key.toLowerCase());
}

const onKeyUp = (e: KeyboardEvent) => e.key === "Meta" && commit();
const onPageMetaUp = (e: Event) => (e as Event & { channel?: string }).channel === "wintos-meta-up" && commit("⌘ released in the page");
const onKeyDown = (e: KeyboardEvent) => {
    // Every key the walk sees, so an Esc that never arrives shows as missing from the trail.
    if (e.key !== "Meta") flog(`walk saw ${e.metaKey ? "⌘" : ""}${e.key}`);
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation(); // the Esc cancels the switch; it must not also interrupt Claude
    end("esc"); // the walk only moved the sidebar's cursor: focus is still where it was
};

const onBlur = () => end("window blur");

function listen(on: boolean): void {
    const f = (on ? window.addEventListener : window.removeEventListener).bind(window);
    f("keyup", onKeyUp, true);
    f("keydown", onKeyDown, true);
    (on ? document.addEventListener : document.removeEventListener).call(document, "ipc-message", onPageMetaUp, true);
    f("blur", onBlur);
}
