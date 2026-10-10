import { atom } from "jotai";

// Per renderer: what fills the project area, and whether mine.md is being edited.
export type MainView = "terminal" | "notes" | "day" | "keyboard";
// A page that is not the tab's own (Today, Keyboard): it covers the tab, which then isn't
// "where you are" — not marked in the sidebar, not where a walk starts.
export const isPage = (v: MainView) => v === "day" || v === "keyboard";
export const mainViewAtom = atom<MainView>("terminal");
export const editingMineAtom = atom(false);
export type Overlay = "" | "palette" | "keymap" | "confirm-close";
export const overlayAtom = atom<Overlay>("");
export const renamingAtom = atom(null as string | null); // the tab whose title is being edited
// Text the notes view scrolls to and marks once it shows (a palette hit in the notes).
// Fired when a key flips a sidebar toggle kept in localStorage, so this window re-reads it.
export const FLAG_EVENT = "wintos-flag";
// ⌥⌘X: the Today card unfolded to tick items off, from wherever you are.
export const tickModeAtom = atom(false);
// ⌥⌘R pressed once: the terminal it would restart, until a second press or 3 s.
export const restartArmedAtom = atom(null as string | null);
export const closeArmedAtom = atom(null as string | null); // the pane a second ⌘W closes
export const findInNotesAtom = atom(null as string | null);
