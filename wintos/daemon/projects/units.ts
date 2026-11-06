// A project's units of work (tickets, phases), each worked in one or more sessions. Kept on one
// front-matter line of project.md, so any session in the project reads and moves them.
export type Unit = { name: string; state: "done" | "current" | "todo" };

const BOX = { done: "[x]", current: "[>]", todo: "[ ]" } as const;
export const UNIT_MAX = 80;
export const UNITS_MAX = 20;

export function parseUnits(line: string): Unit[] {
    return line.split("|").map((part) => part.trim()).filter(Boolean).map((part): Unit => {
        const m = /^\[([ xX>])\]\s*(.*)$/.exec(part);
        if (!m) return { name: part, state: "todo" };
        return { name: m[2].trim(), state: m[1] === ">" ? "current" : m[1] === " " ? "todo" : "done" };
    }).filter((x) => x.name);
}

export const serializeUnits = (units: Unit[]) => units.map((x) => `${BOX[x.state]} ${x.name}`).join(" | ");

export const setUnits = (was: Unit[], names: string[]): Unit[] => names.map((name) => ({ name, state: was.find((x) => x.name === name)?.state ?? "todo" }));

// The same matching as `wintos step`: the exact name, else the first that starts with it.
function find(units: Unit[], q: string): number {
    const want = q.trim().toLowerCase();
    const exact = units.findIndex((x) => x.name.toLowerCase() === want);
    return exact >= 0 ? exact : units.findIndex((x) => x.name.toLowerCase().startsWith(want));
}

// Several can be under way at once (a pilot and the hand-off after it): starting one leaves the others.
export function startUnit(units: Unit[], q: string): Unit[] | undefined {
    const at = find(units, q);
    if (at < 0) return undefined;
    return units.map((x, i) => (i === at ? { ...x, state: "current" } : x));
}
export const unitIndex = (units: Unit[], q: string) => find(units, q);

export function doneUnit(units: Unit[], q: string): Unit[] | undefined {
    const at = find(units, q);
    return at < 0 ? undefined : units.map((x, i) => (i === at ? { ...x, state: "done" } : x));
}
