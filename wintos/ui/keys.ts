// Wave's key map spells modifiers in either order ("Cmd:Shift:w", "Shift:Cmd:w"): as map keys they
// are two entries for one chord, and the first registered wins. A WintOS key replaces any of them.
export const sameChord = (a: string, b: string) => a.split(":").sort().join(":") === b.split(":").sort().join(":");
