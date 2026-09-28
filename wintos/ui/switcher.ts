import { globalStore } from "@/app/store/jotaiStore";
import { atoms, getApi } from "@/store/global";
import { atom } from "jotai";
import { focusArea } from "./focus";

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
    // ponytail: a focused webview swallows the ⌘ release, so from a browser pane each tap switches at once.
    if (!cmdHeld || document.activeElement?.tagName === "WEBVIEW") return commit();
    listen(true);
}

function commit(): void {
    const target = globalStore.get(switchTargetAtom);
    end();
    if (target && target !== globalStore.get(atoms.staticTabId)) getApi().setActiveTab(target);
    else focusArea("terminal");
}

function end(): void {
    globalStore.set(switchTargetAtom, null);
    listen(false);
}

const onKeyUp = (e: KeyboardEvent) => e.key === "Meta" && commit();
const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation(); // the Esc cancels the switch; it must not also interrupt Claude
    end();
    focusArea("terminal");
};

function listen(on: boolean): void {
    const f = (on ? window.addEventListener : window.removeEventListener).bind(window);
    f("keyup", onKeyUp, true);
    f("keydown", onKeyDown, true);
    f("blur", end);
}
