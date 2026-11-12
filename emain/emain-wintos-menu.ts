// WintOS: the menu-bar home for what Wave's widget bar did. Each item asks the focused tab's
// renderer to open the block (wintos/ui/menu.ts).
import * as electron from "electron";
import { ACTIONS } from "../wintos/actions";

type Send = (window: electron.BaseWindow | undefined, action: string) => void;

export function makeBlocksMenu(send: Send): Electron.MenuItemConstructorOptions[] {
    // The menu shows each key but does not take it (registerAccelerator: false): every key goes
    // through the renderer's one key path (zones, the ⌘-hold project walk, text fields, the focus
    // trail). A menu that took ⌘J switched at once and left no walk for Esc to cancel.
    const item = (label: string, action: string, accelerator?: string): Electron.MenuItemConstructorOptions => ({
        label,
        accelerator,
        registerAccelerator: false,
        click: (_, window) => send(window, action),
    });
    // The items with a key come from the one list (wintos/actions.ts), a separator between groups.
    const keyed = ACTIONS.filter((a) => a.menu).flatMap((a, i, all): Electron.MenuItemConstructorOptions[] => [
        ...(i > 0 && all[i - 1].menu!.group !== a.menu!.group ? [{ type: "separator" as const }] : []),
        item(a.menu!.label, a.id, a.menu!.accel),
    ]);
    return [...keyed, { type: "separator" }, item("System Info", "sysinfo"), item("Processes", "processes")];
}

export function makeSettingsItem(send: Send): Electron.MenuItemConstructorOptions {
    return { label: "Settings…", accelerator: "Cmd+,", click: (_, window) => send(window, "settings") };
}
