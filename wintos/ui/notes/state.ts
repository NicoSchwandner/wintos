import { atom } from "jotai";

// Per renderer: what fills the project area, and whether mine.md is being edited.
export type MainView = "terminal" | "notes";
export const mainViewAtom = atom<MainView>("terminal");
export const editingMineAtom = atom(false);
export type Overlay = "" | "palette" | "keymap" | "confirm-close";
export const overlayAtom = atom<Overlay>("");
export const renamingAtom = atom(null as string | null); // the tab whose title is being edited
