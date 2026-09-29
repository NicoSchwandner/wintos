// A view's single-letter keys (j, k, r, e, 1–9) must not also fire for ⌘J, ⌘R, ⌘E…, which
// are WintOS's own: ⌘J moved the PR list and switched the project at once.
export const isPlainKey = (e: { metaKey: boolean; ctrlKey: boolean; altKey: boolean }) => !e.metaKey && !e.ctrlKey && !e.altKey;

// Wave's key map spells modifiers in either order ("Cmd:Shift:w", "Shift:Cmd:w"): as map keys they
// are two entries for one chord, and the first registered wins. A WintOS key replaces any of them.
export const sameChord = (a: string, b: string) => a.split(":").sort().join(":") === b.split(":").sort().join(":");
