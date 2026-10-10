// WintOS: the menu-bar home for what Wave's widget bar did. Each item asks the focused tab's
// renderer to open the block (wintos/ui/menu.ts).
import * as electron from "electron";

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
    // Mirrors WINTOS_KEYS (wintos/ui/menu.ts), which the renderer handles first.
    return [
        item("Everything…", "palette", "Shift+Cmd+P"),
        item("Keyboard Shortcuts", "keymap", "Shift+Cmd+K"),
        { type: "separator" },
        item("Next Project", "switch-next", "Cmd+J"),
        item("Previous Project", "switch-prev", "Cmd+K"),
        item("New Project", "project", "Cmd+N"),
        item("Rename Project", "rename", "Cmd+R"),
        item("Close Project", "close-project", "Shift+Cmd+W"),
        item("Snooze Project", "snooze-project", "Alt+Cmd+Z"),
        item("Park Session (nothing for me)", "park-session", "Alt+Cmd+P"),
        item("Join Meeting", "join-meeting", "Shift+Cmd+J"),
        item("Today", "day", "Shift+Cmd+Y"),
        item("Keyboard Game", "keyboard", "Shift+Cmd+I"),
        item("Copy Page URL", "copy-url", "Shift+Cmd+C"),
        item("Open Page in Browser", "open-external", "Shift+Cmd+U"),
        item("Show Snoozed Projects", "show-snoozed", "Alt+Cmd+S"),
        item("Restart Terminal", "restart-terminal", "Alt+Cmd+R"),
        item("Tick Off Today", "tick", "Alt+Cmd+X"),
        { type: "separator" },
        item("Focus Left", "focus-left", "Cmd+H"),
        item("Focus Right", "focus-right", "Cmd+L"),
        item("Pane Below", "pane-down", "Alt+Cmd+J"),
        item("Pane Above", "pane-up", "Alt+Cmd+K"),
        { type: "separator" },
        item("New Terminal", "terminal", "Cmd+T"),
        item("New Claude Session", "session", "Shift+Cmd+T"),
        item("New Browser", "browser", "Shift+Cmd+B"),
        item("Files", "files", "Shift+Cmd+F"),
        item("Notes", "notes", "Shift+Cmd+L"),
        item("Edit mine.md", "edit-mine", "Cmd+E"),
        item("PRs Need Attention", "prs", "Shift+Cmd+G"),
        item("On Call", "panel", "Shift+Cmd+O"),
        { type: "separator" },
        item("System Info", "sysinfo"),
        item("Processes", "processes"),
    ];
}

export function makeSettingsItem(send: Send): Electron.MenuItemConstructorOptions {
    return { label: "Settings…", accelerator: "Cmd+,", click: (_, window) => send(window, "settings") };
}
