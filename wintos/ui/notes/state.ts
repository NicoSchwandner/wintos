import { atom } from "jotai";

// Per renderer: what fills the project area, and whether mine.md is being edited.
export type MainView = "terminal" | "day" | "reflect" | "keyboard";
// A page that is not the tab's own (Today, Reflect, Keyboard): it covers the tab, which then isn't
// "where you are" — not marked in the sidebar, not where a walk starts.
export const isPage = (v: MainView) => v !== "terminal";
export const mainViewAtom = atom<MainView>("terminal");
export const editingMineAtom = atom(false);
export type Overlay = "" | "palette" | "keymap" | "confirm-close" | "name-session";
export const overlayAtom = atom<Overlay>("");
export const renamingAtom = atom(null as string | null); // the tab whose title is being edited
// Text the notes view scrolls to and marks once it shows (a palette hit in the notes).
// ⌥⌘X: the Today card unfolded to tick items off, from wherever you are.
export const tickModeAtom = atom(false);
// ⌥⌘R pressed once: the terminal it would restart, until a second press or 3 s.
export const restartArmedAtom = atom(null as string | null);
export const closeArmedAtom = atom(null as string | null); // the pane a second ⌘W closes
