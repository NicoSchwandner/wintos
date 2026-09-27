import { atom } from "jotai";

// Per renderer: whether the full-width notes view (⌘J) is open, and whether mine.md is being edited.
export const notesOpenAtom = atom(false);
export const editingMineAtom = atom(false);
