import { getApi } from "@/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";
import { enterProject, focusArea, focusedSession, whereYouAre } from "./focus";
import { goToInbox } from "./inbox";
import { openEpic, openView } from "./menu";
import type { InboxList } from "./view";
import { flog } from "./focusLog";

// ⌘J / ⌘K work like ⌘⇥: hold ⌘ and tap to walk the rows of this renderer's sidebar, release ⌘
// to switch once. ⌃⇥ walks every session by what it asks of you: those that need you first
// (oldest first), then those with something to read, then the rest (latest first).
// Walking without switching keeps the cursor in the one renderer that owns it (every Wave tab is
// its own renderer).
export const switchTargetAtom = atom(null as string | null);

// The sidebar's rows top to bottom: tabs, "s:<session>" rows (tabOf says whose tab), cards.
let order: string[] = [];
let tabOf: Record<string, string> = {};
// ⌃⇥'s order: needs you, to read, the rest; the sidebar ranks them (cycleOrder).
let cycle: string[] = [];
// alias: a session's row shown under another key (by epic, the agent's row is its epic's heading).
let alias: Record<string, string> = {};
export const setSwitchOrder = (keys: string[], tabs: Record<string, string> = {}, priority: string[] = [], aliases: Record<string, string> = {}) => ((order = keys), (tabOf = tabs), (cycle = priority), (alias = aliases));

// The order ⌃⇥ walks, each key once: what needs you (oldest first), what has something to read
// (oldest first), then the rest as given (latest first).
export const cycleOrder = (needs: string[], read: string[], rest: string[]) => [...new Set([...needs, ...read, ...rest])];
// Frozen while ⌃ is held: answering a session mid-walk would otherwise reshuffle the rest.
let frozen: string[] | null = null;
// "wake:<project>" stops: a closed project's due wake, which opening reopens on its session.
// "bg:<session>" stops: a session its epic's agent started in the background, waiting on you.
let wakeStops: Record<string, () => void> = {};
export const setWakeStops = (stops: Record<string, () => void>) => (wakeStops = stops);
// Where closing a project lands: the uppermost project in the sidebar. The walk's other stops
// (card:…, wake:…) sit above the projects and are no tab.
export function topProject(closing: string): string | undefined {
    for (const key of order) {
        const tab = key.startsWith("s:") ? tabOf[key] : key.includes(":") ? undefined : key;
        if (tab && tab !== closing) return tab;
    }
    return undefined;
}

// ⌥⌘1-9: the sidebar's rows, top to bottom; the cards above them are no rows.
export function toRow(n: number): void {
    const target = order.filter((k) => !k.startsWith("card:") && !k.startsWith("epic:") && !k.startsWith("wake:") && !k.startsWith("bg:"))[n - 1];
    if (target) go(target);
}

// Where a walk starts: the focused session's row when it has one, else what is showing.
function here(): string {
    const where = whereYouAre();
    const s = focusedSession();
    const key = s && s.tabId === where ? `s:${s.id}` : undefined;
    return key && order.includes(key) ? key : where;
}

export function stepProject(order: string[], current: string, delta: 1 | -1): string | undefined {
    if (!order.length) return undefined;
    const i = order.indexOf(current);
    if (i < 0) return delta > 0 ? order[0] : order[order.length - 1];
    return order[(i + delta + order.length) % order.length];
}

// hold: the key whose release switches, ⌘ for ⌘J/⌘K, ⌃ for ⌃⇥.
let hold: "Meta" | "Control" = "Meta";
// from: "here" steps from where you are (⌘J/⌘K); "top" starts each walk at the first row that needs
// you, or the last for ⌃⇧⇥, and walks only those (⌃⇥).
export function switchProject(delta: 1 | -1, held: boolean, from: "here" | "top" = "here"): void {
    if (!walking()) hold = from === "top" ? "Control" : "Meta";
    const at = globalStore.get(switchTargetAtom);
    // ⌘J/⌘K walks the rows; the cards above them have keys of their own (⇧⌘Y, ⇧⌘G, ⇧⌘O). ⌃⇥
    // walks the ranked sessions, the one you are in left out, frozen for the whole walk.
    if (from === "top" && at == null) {
        const s = focusedSession();
        const mine = new Set([here(), ...(s ? [`s:${s.id}`, alias[`s:${s.id}`]] : [])]);
        frozen = cycle.filter((k) => !mine.has(k));
    }
    const stops = from === "top" ? (frozen ?? []) : order.filter((k) => !k.startsWith("card:"));
    const next = stepProject(stops, at ?? (from === "top" ? "" : here()), delta);
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
    else if (target?.startsWith("wake:") || target?.startsWith("bg:")) wakeStops[target]?.();
    else if (target?.startsWith("epic:")) openEpic(target.slice(5));
    else if (target) enterProject(target);
    else focusArea("terminal");
}

function commit(why = `${hold === "Meta" ? "⌘" : "⌃"} released`): void {
    const target = globalStore.get(switchTargetAtom);
    const from = here();
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
    frozen = null;
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
