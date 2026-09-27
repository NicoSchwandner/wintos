import { atom } from "jotai";

// Per renderer: what fills the project area, and whether mine.md is being edited.
export type MainView = "terminal" | "notes" | "prs" | "oncall";
export const mainViewAtom = atom<MainView>("terminal");
export const editingMineAtom = atom(false);
