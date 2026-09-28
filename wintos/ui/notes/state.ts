import { atom } from "jotai";
import { NO_TABS, type PrTabs } from "../prtabs";

// Per renderer: what fills the project area, and whether mine.md is being edited.
export type MainView = "terminal" | "notes" | "prs" | "panel";
export const mainViewAtom = atom<MainView>("terminal");
export const editingMineAtom = atom(false);
export const panelNameAtom = atom(""); // "" means none
export type Overlay = "" | "palette" | "keymap" | "confirm-close";
export const overlayAtom = atom<Overlay>("");
export const prTabsAtom = atom<PrTabs>(NO_TABS); // the browser tabs beside the PR queue
export const prCopiedAtom = atom(false); // flashes "copied" after ⇧⌘C
export const renamingAtom = atom(null as string | null); // the tab whose title is being edited
