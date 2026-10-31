import type { KeyTable } from "./zones";

// The vim moves every list shares beyond j/k: gg to the top, G to the bottom, ⌃D / ⌃U half a
// page (8 rows) down and up. step moves by a count; to goes to an end.
const HALF = 8;
let lastG = 0;

export const motionKeys = (step: (by: number) => void, to: (end: "first" | "last") => void): KeyTable => ({
    // gg: two g within half a second.
    g: () => {
        const now = Date.now();
        if (now - lastG < 500) (to("first"), (lastG = 0));
        else lastG = now;
    },
    "Shift:g": () => to("last"),
    "Ctrl:d": () => step(HALF),
    "Ctrl:u": () => step(-HALF),
});
