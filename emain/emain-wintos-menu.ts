// WintOS: the menu-bar home for what Wave's widget bar did. Each item asks the focused tab's
// renderer to open the block (wintos/ui/menu.ts).
import * as electron from "electron";

type Send = (window: electron.BaseWindow | undefined, action: string) => void;

export function makeBlocksMenu(send: Send): Electron.MenuItemConstructorOptions[] {
    const item = (label: string, action: string, accelerator?: string): Electron.MenuItemConstructorOptions => ({
        label,
        accelerator,
        click: (_, window) => send(window, action),
    });
    return [
        item("New Session", "session", "Shift+Cmd+N"),
        item("New Terminal", "terminal"),
        item("New Browser", "browser", "Shift+Cmd+B"),
        item("Files", "files", "Shift+Cmd+E"),
        { type: "separator" },
        item("System Info", "sysinfo"),
        item("Processes", "processes"),
    ];
}

export function makeSettingsItem(send: Send): Electron.MenuItemConstructorOptions {
    return { label: "Settings…", accelerator: "Cmd+,", click: (_, window) => send(window, "settings") };
}
