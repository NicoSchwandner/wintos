import { globalStore } from "@/app/store/jotaiStore";
import { atoms } from "@/store/global";
import { atom } from "jotai";
import { enterProject, focusArea } from "./focus";
import { flog } from "./focusLog";

// ⌘J / ⌘K work like ⌘⇥: hold ⌘ and tap to walk the ranked projects in this renderer's
// sidebar, release ⌘ to switch once. Walking without switching keeps the cursor in the one
// renderer that owns it (every Wave tab is its own renderer).
export const switchTargetAtom = atom(null as string | null);

let order: string[] = [];
export const setSwitchOrder = (tabIds: string[]) => (order = tabIds);

export function stepProject(order: string[], current: string, delta: 1 | -1): string | undefined {
    if (!order.length) return undefined;
    const i = order.indexOf(current);
    if (i < 0) return delta > 0 ? order[0] : order[order.length - 1];
    return order[(i + delta + order.length) % order.length];
}

export function switchProject(delta: 1 | -1, cmdHeld: boolean): void {
    const next = stepProject(order, globalStore.get(switchTargetAtom) ?? globalStore.get(atoms.staticTabId), delta);
    if (!next) return;
    globalStore.set(switchTargetAtom, next);
    if (!cmdHeld) return commit("menu");
    flog(`walk → ${next.slice(0, 6)}`);
    listen(true);
}

function commit(why = "⌘ released"): void {
    const target = globalStore.get(switchTargetAtom);
    end(why);
    if (target && target !== globalStore.get(atoms.staticTabId)) enterProject(target);
    else focusArea("terminal");
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
