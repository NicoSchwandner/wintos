import { startUnit, UNIT_MAX, UNITS_MAX, type Unit } from "../projects/units";

// The roadmap as you edit it on the epic page, and which sessions worked each step. A step is known
// by its name, so the links follow a rename and go with a removed step. Each edit returns a line
// for the epic agent, which hears of every edit you make by hand.
export type Links = Record<string, string[]>;
export type RoadmapOp = { add: string } | { rename: { from: string; to: string } } | { move: { name: string; by: 1 | -1 } } | { done: string; on: boolean } | { remove: string };
type Roadmap = { steps: Unit[]; links: Links };

const LINKS_MAX = 10;
const okName = (s: unknown): s is string => typeof s === "string" && !!s.trim() && !s.includes("|") && !/[\r\n\u0000-\u001f]/.test(s) && s.trim().length <= UNIT_MAX;

export function editRoadmap({ steps, links }: Roadmap, op: RoadmapOp): (Roadmap & { note: string }) | string {
    const at = (name: string) => steps.findIndex((u) => u.name === name);
    const taken = (name: string) => steps.some((u) => u.name.toLowerCase() === name.toLowerCase());
    if ("add" in op) {
        if (!okName(op.add)) return `a step is one line up to ${UNIT_MAX} characters, without |`;
        const name = op.add.trim();
        if (taken(name)) return "the roadmap has that step already";
        if (steps.length >= UNITS_MAX) return `the roadmap holds ${UNITS_MAX} steps at most`;
        return { steps: [...steps, { name, state: "todo" }], links, note: `added "${name}"` };
    }
    if ("rename" in op) {
        const i = at(op.rename.from);
        if (i < 0) return "no such step";
        if (!okName(op.rename.to)) return `a step is one line up to ${UNIT_MAX} characters, without |`;
        const to = op.rename.to.trim();
        if (to === op.rename.from) return { steps, links, note: "" };
        if (to.toLowerCase() !== op.rename.from.toLowerCase() && taken(to)) return "the roadmap has that step already";
        const { [op.rename.from]: moved, ...rest } = links;
        return { steps: steps.map((u, j) => (j === i ? { ...u, name: to } : u)), links: moved ? { ...rest, [to]: moved } : rest, note: `renamed "${op.rename.from}" to "${to}"` };
    }
    if ("move" in op) {
        const i = at(op.move.name);
        const j = i + op.move.by;
        if (i < 0) return "no such step";
        if (j < 0 || j >= steps.length) return { steps, links, note: "" };
        const next = [...steps];
        [next[i], next[j]] = [next[j], next[i]];
        return { steps: next, links, note: `moved "${op.move.name}" ${op.move.by < 0 ? "up" : "down"}, before "${next[j + 1]?.name ?? "the end"}"` };
    }
    if ("done" in op) {
        const i = at(op.done);
        if (i < 0) return "no such step";
        return { steps: steps.map((u, j) => (j === i ? { ...u, state: op.on ? "done" : "todo" } : u)), links, note: op.on ? `marked "${op.done}" done` : `opened "${op.done}" again` };
    }
    const i = at(op.remove);
    if (i < 0) return "no such step";
    const { [op.remove]: _, ...rest } = links;
    return { steps: steps.filter((_u, j) => j !== i), links: rest, note: `removed "${op.remove}"` };
}

// A session starts a step: the step is current and the session is one of those that worked it.
export function linkStep({ steps, links }: Roadmap, name: string, sessionId: string): Roadmap | undefined {
    const next = startUnit(steps, name);
    if (!next) return undefined;
    const unit = next.find((u) => u.state === "current")!.name;
    return { steps: next, links: { ...links, [unit]: [...(links[unit] ?? []).filter((x) => x !== sessionId), sessionId].slice(-LINKS_MAX) } };
}

// After the agent sets the whole list with wintos unit, links to steps that are gone are dropped.
export const pruneLinks = (links: Links, steps: Unit[]): Links => Object.fromEntries(Object.entries(links).filter(([name]) => steps.some((u) => u.name === name)));

export function parseLinks(raw: string | undefined): Links {
    try {
        const v = raw ? JSON.parse(raw) : {};
        return Object.fromEntries(Object.entries(v).filter((e): e is [string, string[]] => Array.isArray(e[1]) && e[1].every((x) => typeof x === "string")));
    } catch {
        return {};
    }
}
