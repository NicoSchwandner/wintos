import { atom } from "jotai";

// Per renderer: what fills the project area, and whether mine.md is being edited.
export type MainView = "terminal" | "day" | "reflect" | "keyboard" | "epic";
// The epic the epic page shows (openEpic).
export const openEpicAtom = atom("");
// The epic ⌘N's sheet starts on when opened from an epic's "+ new step" in the sidebar.
export const newStepEpicAtom = atom("");
// A page that is not the tab's own (Today, Reflect, Keyboard): it covers the tab, which then isn't
// "where you are" — not marked in the sidebar, not where a walk starts.
export const isPage = (v: MainView) => v !== "terminal";
export const mainViewAtom = atom<MainView>("terminal");
export const editingMineAtom = atom(false);
export type Overlay = "" | "palette" | "keymap" | "confirm-close" | "name-session" | "epic" | "new-step" | "move-session";
export const overlayAtom = atom<Overlay>("");
export const renamingAtom = atom(null as string | null); // the tab whose title is being edited
// ⌥⌘R pressed once: the terminal it would restart, until a second press or 3 s.
export const restartArmedAtom = atom(null as string | null);
export const updateArmedAtom = atom(false);
export const closeArmedAtom = atom(null as string | null); // the pane a second ⌘W closes
// How many projects are in Your move now, as the sidebar counts them: a nudge to move waits until none.
export const yourMoveAtom = atom(0);
