// Focus is always in one of four zones, read from `data-zone` on the focused element's container
// rather than kept as component state: a view that forgets to update state can't desync it.
// Each zone container registers its keys here, and Wave's one keydown path asks this table first.
import { checkKeyPressed } from "@/util/keyutil";
import { RefObject, useEffect } from "react";

export type Zone = "pane" | "list" | "strip" | "overlay";
export type KeyTable = Record<string, (e: WaveKeyboardEvent) => void | boolean>;

const zoneContainer = (el: Element | null) => (el?.closest?.("[data-zone]") ?? null) as HTMLElement | null;
export const zoneOf = (el: Element | null): Zone => (zoneContainer(el)?.dataset.zone as Zone) ?? "pane";

const tables = new WeakMap<Element, KeyTable>();
export const setZoneKeys = (container: Element, table: KeyTable) => void tables.set(container, table);

// Re-registered every render, so handlers always see the view's current state.
export function useZoneKeys(ref: RefObject<HTMLElement>, table: KeyTable): void {
    useEffect(() => {
        if (ref.current) setZoneKeys(ref.current, table);
    });
}

const isTextField = (el: Element | null) => el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || (el as HTMLElement | null)?.isContentEditable === true;

export function zoneKey(e: WaveKeyboardEvent, active: Element | null): boolean {
    const container = zoneContainer(active);
    const table = container && tables.get(container);
    if (!table) return false;
    const typing = isTextField(active);
    for (const [desc, run] of Object.entries(table)) {
        // In a text field a bare letter or digit is typing, never a command.
        if (typing && desc.length === 1) continue;
        if (checkKeyPressed(e, desc)) return run(e) !== false;
    }
    return false;
}

export function escapeAction(c: { overlay: boolean; zone: Zone; inInbox: boolean; onPage: boolean }): "overlay" | "list" | "panes" | "wave" {
    if (c.overlay) return "overlay";
    if (c.zone === "list" || c.zone === "strip") return "panes";
    if (c.inInbox && c.onPage) return "list";
    return "wave";
}

// ⌘W closes the innermost thing you can see, never a project and never something hidden.
export function closeAction(c: { overlay: boolean; notesShown: boolean; zone: Zone; paneFocused: boolean; paneHidden: boolean }): "overlay" | "view" | "pane" | "nothing" {
    if (c.overlay) return "overlay";
    if (c.notesShown) return "view";
    if (c.zone !== "pane" || !c.paneFocused || c.paneHidden) return "nothing";
    return "pane";
}
