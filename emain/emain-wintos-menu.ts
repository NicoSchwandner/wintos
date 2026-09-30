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
        { type: "separator" },
        item("Focus Left (terminals · Inbox list)", "focus-left", "Cmd+H"),
        item("Focus Right (notes · Inbox page)", "focus-right", "Cmd+L"),
        item("Pane Left", "pane-left", "Alt+Cmd+H"),
        item("Pane Down", "pane-down", "Alt+Cmd+J"),
        item("Pane Up", "pane-up", "Alt+Cmd+K"),
        item("Pane Right", "pane-right", "Alt+Cmd+L"),
        { type: "separator" },
        item("New Terminal", "terminal", "Cmd+T"),
        item("New Claude Session", "session", "Shift+Cmd+T"),
        item("New Browser", "browser", "Shift+Cmd+B"),
        item("Files", "files", "Shift+Cmd+E"),
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
