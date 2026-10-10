// Focus is always in one of three zones (the pane strip has nothing that takes focus), read from `data-zone` on the focused element's container
// rather than kept as component state: a view that forgets to update state can't desync it.
// Each zone container registers its keys here, and Wave's one keydown path asks this table first.
import { checkKeyPressed, isCharacterKeyEvent } from "@/util/keyutil";
import { RefObject, useEffect } from "react";

export type Zone = "pane" | "list" | "overlay";
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

// "handled": the zone ran it. "typing": a text field keeps it (the browser types or edits), and
// neither Wave's keys nor the pane behind the field see it. false: it goes on to Wave.
export function zoneKey(e: WaveKeyboardEvent, active: Element | null): "handled" | "typing" | false {
    const container = zoneContainer(active);
    const table = container && tables.get(container);
    if (!table) return false;
    const typing = isTextField(active);
    if (!(typing && isCharacterKeyEvent(e))) {
        for (const [desc, run] of Object.entries(table)) if (checkKeyPressed(e, desc) && run(e) !== false) return "handled";
    }
    // Esc still leaves a field: it closes the overlay the field sits in.
    return typing && e.key !== "Escape" ? "typing" : false;
}

export function escapeAction(c: { overlay: boolean; zone: Zone; inInbox: boolean; onPage: boolean }): "overlay" | "list" | "panes" | "wave" {
    if (c.overlay) return "overlay";
    if (c.zone === "list") return "panes";
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
