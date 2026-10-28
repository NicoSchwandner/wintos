import { getApi } from "@/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";
import { enterProject, focusArea, whereYouAre } from "./focus";
import { goToInbox } from "./inbox";
import { openView } from "./menu";
import type { InboxList } from "./view";
import { flog } from "./focusLog";

// ⌘J / ⌘K work like ⌘⇥: hold ⌘ and tap to walk the ranked projects in this renderer's
// sidebar, release ⌘ to switch once. ⌃⇥ walks the same stops the most recent first, like a
// window switcher: one tap is back to where you were. Walking without switching keeps the cursor
// in the one renderer that owns it (every Wave tab is its own renderer).
export const switchTargetAtom = atom(null as string | null);

let order: string[] = [];
export const setSwitchOrder = (tabIds: string[]) => (order = tabIds);
// "wake:<project>" stops: a closed project's due wake, which opening reopens on its session.
let wakeStops: Record<string, () => void> = {};
export const setWakeStops = (stops: Record<string, () => void>) => (wakeStops = stops);
// Where closing a project lands: the uppermost project in the sidebar. The walk's other stops
// (card:…, wake:…) sit above the projects and are no tab.
export const topProject = (closing: string) => order.find((id) => id !== closing && !id.includes(":"));

export function stepProject(order: string[], current: string, delta: 1 | -1): string | undefined {
    if (!order.length) return undefined;
    const i = order.indexOf(current);
    if (i < 0) return delta > 0 ? order[0] : order[order.length - 1];
    return order[(i + delta + order.length) % order.length];
}

// Where you were, most recent first, shared by every renderer: each is one tab, and only the one
// showing records its visit.
const RECENT = "wintos:recent";
const RECENT_KEPT = 50;
const recentVisits = (): string[] => {
    try {
        return JSON.parse(localStorage.getItem(RECENT) ?? "[]");
    } catch {
        return [];
    }
};
export function visited(stop: string): void {
    if (!stop) return;
    try {
        localStorage.setItem(RECENT, JSON.stringify([stop, ...recentVisits().filter((s) => s !== stop)].slice(0, RECENT_KEPT)));
    } catch {} // no storage: ⌃⇥ walks the sidebar's order
}
export const recentFirst = (stops: string[], recent: string[]): string[] => [...recent.filter((s) => stops.includes(s)), ...stops.filter((s) => !recent.includes(s))];

// hold: the key whose release switches, ⌘ for ⌘J/⌘K, ⌃ for ⌃⇥.
let hold: "Meta" | "Control" = "Meta";
export function switchProject(delta: 1 | -1, held: boolean, by: "rank" | "recent" = "rank"): void {
    if (!walking()) hold = by === "recent" ? "Control" : "Meta";
    const stops = by === "recent" ? recentFirst(order, recentVisits()) : order;
    const next = stepProject(stops, globalStore.get(switchTargetAtom) ?? whereYouAre(), delta);
    if (!next) return;
    globalStore.set(switchTargetAtom, next);
    if (!held) return commit("menu");
    flog(`walk → ${next.slice(0, 6)}`);
    listen(true);
}

// A card opens what it shows; a project is entered, even the one you're in, so a page over it
// (Today) goes away.
function go(target: string | null): void {
    if (target === "card:prs" || target === "card:oncall") goToInbox(target.slice(5) as InboxList);
    else if (target === "card:today") openView("day");
    else if (target?.startsWith("wake:")) wakeStops[target]?.();
    else if (target) enterProject(target);
    else focusArea("terminal");
}

function commit(why = `${hold === "Meta" ? "⌘" : "⌃"} released`): void {
    const target = globalStore.get(switchTargetAtom);
    const from = whereYouAre();
    end(why);
    try {
        if (target && target !== from) localStorage.setItem(UNDO, JSON.stringify({ from, at: Date.now() }));
    } catch {} // no storage, no undo; the walk itself goes on
    go(target);
}

// A walk is cancelled with ⌘Esc (see listen), and Esc right after it lands takes it back too. The walk ends in another tab, another
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

// While walking only its own keys (⌘J/⌘K, or ⌃⇥), Esc and the held key's release count: the walk
// chooses a project, so any other key with it held (⌘H/⌘L moving focus in the project you are
// leaving) is swallowed. A key without it means its release never reached us: the walk
// switches, and the key goes on.
export function walkKey(e: { cmd?: boolean; control?: boolean; key: string }): boolean {
    if (!walking()) return false;
    if (e.key === "Escape") return end("esc"), true;
    if (!(hold === "Meta" ? e.cmd : e.control)) return commit(`${hold === "Meta" ? "⌘" : "⌃"} was already up`), false;
    return !(hold === "Meta" ? ["j", "k"] : ["tab"]).includes(e.key.toLowerCase());
}

const onKeyUp = (e: KeyboardEvent) => e.key === hold && commit();
const onKeyDown = (e: KeyboardEvent) => {
    // Every key the walk sees, so an Esc that never arrives shows as missing from the trail.
    if (e.key !== hold) flog(`walk saw ${e.metaKey ? "⌘" : ""}${e.ctrlKey ? "⌃" : ""}${e.key}`);
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation(); // the Esc cancels the switch; it must not also interrupt Claude
    end("esc"); // the walk only moved the sidebar's cursor: focus is still where it was
};

const onBlur = () => end("window blur");

// ⌘Esc during a walk comes from the main process, which holds it while the walk runs. So does
// the ⌘ release in a page: the page's own DOM drops it now and then, and its keys never reach us.
let hooked = false;
function listen(on: boolean): void {
    if (on && !hooked) {
        hooked = true;
        getApi()?.onWintosWalkEsc?.(() => end("⌘esc"));
        getApi()?.onWintosWalkMetaUp?.(() => walking() && commit(`${hold === "Meta" ? "⌘" : "⌃"} released in the page`));
    }
    getApi()?.setWintosWalking?.(on, hold);
    const f = (on ? window.addEventListener : window.removeEventListener).bind(window);
    f("keyup", onKeyUp, true);
    f("keydown", onKeyDown, true);
    f("blur", onBlur);
}
