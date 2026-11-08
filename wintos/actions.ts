// Every WintOS action that has a key, in one list. The renderer's key map (ui/menu.ts), the native
// menu (emain/emain-wintos-menu.ts) and the palette's actions are made from it, and a test holds
// the keymap card to it, so a key, its label and its handler can't drift apart again (three
// hand-kept lists had grown dead items and different names for one action). Pure: the main
// process imports it too.

// id: what runAction (ui/menu.ts) handles. chords: Wave's key descriptions; ⌥ turns a letter or a
// digit into another character on macOS, so every ⌥⌘ key matches the key's place ({KeyX}).
// key: as shown. menu: the native menu's item, with its accelerator; a new group starts a
// separator. palette: the palette's line, {here} the view's title.
export type Action = { id: string; chords: string[]; key: string; menu?: { label: string; accel: string; group: number }; palette?: string };

export const ACTIONS: Action[] = [
    { id: "palette", chords: ["Shift:Cmd:p"], key: "⇧⌘P", menu: { label: "Everything…", accel: "Shift+Cmd+P", group: 0 } },
    { id: "keymap", chords: ["Shift:Cmd:k"], key: "⇧⌘K", menu: { label: "Keyboard Shortcuts", accel: "Shift+Cmd+K", group: 0 }, palette: "Keyboard shortcuts" },
    { id: "switch-next", chords: ["Cmd:j"], key: "⌘J", menu: { label: "Next in the Sidebar", accel: "Cmd+J", group: 1 } },
    { id: "switch-prev", chords: ["Cmd:k"], key: "⌘K", menu: { label: "Previous in the Sidebar", accel: "Cmd+K", group: 1 } },
    { id: "new-step", chords: ["Cmd:n"], key: "⌘N", menu: { label: "New Session…", accel: "Cmd+N", group: 1 }, palette: "New session: its epic and what it is for, in a view of its own" },
    { id: "rename", chords: ["Cmd:r"], key: "⌘R", menu: { label: "Name This Session", accel: "Cmd+R", group: 1 }, palette: "Rename {here}" },
    { id: "close-project", chords: ["Shift:Cmd:w"], key: "⇧⌘W", menu: { label: "Close View", accel: "Shift+Cmd+W", group: 1 }, palette: "Close {here}" },
    { id: "park-session", chords: ["Option:Cmd:c{KeyP}"], key: "⌥⌘P", menu: { label: "Pause Session (nothing for me)", accel: "Alt+Cmd+P", group: 1 }, palette: "Pause the waiting session: nothing for you" },
    { id: "epic", chords: ["Option:Cmd:c{KeyE}"], key: "⌥⌘E", menu: { label: "Session's Epic…", accel: "Alt+Cmd+E", group: 1 }, palette: "Put this session in an epic, or start one" },
    { id: "epic-page", chords: ["Shift:Option:Cmd:c{KeyE}"], key: "⇧⌥⌘E", menu: { label: "Epic's Page", accel: "Shift+Alt+Cmd+E", group: 1 }, palette: "This session's epic: its agent's view, else its page" },
    { id: "move-session", chords: ["Option:Cmd:c{KeyM}"], key: "⌥⌘M", menu: { label: "Move Session…", accel: "Alt+Cmd+M", group: 1 }, palette: "Move this session to another view" },
    { id: "take-out", chords: ["Option:Cmd:c{KeyT}"], key: "⌥⌘T", menu: { label: "Take Session Out", accel: "Alt+Cmd+T", group: 1 }, palette: "Take this session out into a view of its own" },
    { id: "open-pane-pr", chords: ["Option:Cmd:c{KeyG}"], key: "⌥⌘G", menu: { label: "The Pane's Urgent PR", accel: "Alt+Cmd+G", group: 1 }, palette: "The focused pane's most urgent PR" },
    { id: "join-meeting", chords: ["Shift:Cmd:j"], key: "⇧⌘J", menu: { label: "Join Meeting", accel: "Shift+Cmd+J", group: 1 }, palette: "Join the meeting" },
    { id: "day", chords: ["Shift:Cmd:y"], key: "⇧⌘Y", menu: { label: "Epics Home", accel: "Shift+Cmd+Y", group: 1 }, palette: "Epics home: your day, a card per epic, the month by epic" },
    // The key marked Y is where Z is on a German (QWERTZ) keyboard: ⌥⌘Y works on either.
    { id: "reflect", chords: ["Option:Cmd:c{KeyY}", "Option:Cmd:c{KeyZ}"], key: "⌥⌘Y", menu: { label: "Reflect", accel: "Alt+Cmd+Y", group: 1 }, palette: "Reflect: this week's reflection and what it looks back on" },
    { id: "keyboard", chords: ["Shift:Cmd:i"], key: "⇧⌘I", menu: { label: "Keyboard Game", accel: "Shift+Cmd+I", group: 1 }, palette: "Keyboard: rank, streak, badges" },
    { id: "copy-url", chords: ["Shift:Cmd:c"], key: "⇧⌘C", menu: { label: "Copy Page URL", accel: "Shift+Cmd+C", group: 1 }, palette: "Copy the focused page's url" },
    { id: "restart-terminal", chords: ["Option:Cmd:c{KeyR}"], key: "⌥⌘R", menu: { label: "Restart Terminal", accel: "Alt+Cmd+R", group: 1 }, palette: "Restart the focused terminal" },
    { id: "update", chords: ["Option:Cmd:c{KeyU}"], key: "⌥⌘U", menu: { label: "Update WintOS", accel: "Alt+Cmd+U", group: 1 }, palette: "Update WintOS: rebuild and restart it" },
    { id: "break", chords: ["Option:Cmd:c{KeyB}"], key: "⌥⌘B", menu: { label: "Take a Break", accel: "Alt+Cmd+B", group: 1 }, palette: "Take a break now" },
    { id: "break-later", chords: ["Shift:Option:Cmd:c{KeyB}"], key: "⇧⌥⌘B", menu: { label: "Move Nudge Later", accel: "Shift+Alt+Cmd+B", group: 1 }, palette: "Move nudge: ask again in 10 minutes" },
    { id: "focus-left", chords: ["Cmd:h"], key: "⌘H", menu: { label: "Focus Left", accel: "Cmd+H", group: 2 } },
    { id: "focus-right", chords: ["Cmd:l"], key: "⌘L", menu: { label: "Focus Right", accel: "Cmd+L", group: 2 } },
    { id: "terminal", chords: ["Cmd:t"], key: "⌘T", menu: { label: "New Terminal", accel: "Cmd+T", group: 3 }, palette: "New terminal in {here}" },
    { id: "rail", chords: ["Option:Cmd:c{KeyL}"], key: "⌥⌘L", menu: { label: "Notes Rail", accel: "Alt+Cmd+L", group: 3 }, palette: "Fold or unfold the notes rail" },
    { id: "edit-mine", chords: ["Cmd:e"], key: "⌘E", menu: { label: "Edit mine.md", accel: "Cmd+E", group: 3 }, palette: "Edit mine.md of {here}" },
    { id: "prs", chords: ["Shift:Cmd:g"], key: "⇧⌘G", menu: { label: "PRs", accel: "Shift+Cmd+G", group: 3 }, palette: "PRs: yours and your team's" },
    { id: "panel", chords: ["Shift:Cmd:o"], key: "⇧⌘O", menu: { label: "On Call", accel: "Shift+Cmd+O", group: 3 } },
    ...Array.from({ length: 9 }, (_, i): Action => ({ id: `session-${i + 1}`, chords: [`Option:Cmd:c{Digit${i + 1}}`], key: `⌥⌘${i + 1}` })),
];

// The renderer's key map: [Wave key description, action].
export const KEY_BINDINGS: [string, string][] = ACTIONS.flatMap((a) => a.chords.map((c): [string, string] => [c, a.id]));
