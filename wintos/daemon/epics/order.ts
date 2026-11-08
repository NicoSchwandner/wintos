import type { Epic } from "./epics";

// The one order of the epics, everywhere they are listed (the sidebar, the home): pinned first,
// then your own order, then by name. It holds still while their sessions change state.
export function orderEpics<T extends Pick<Epic, "id" | "title" | "short" | "pinned" | "rank">>(epics: T[]): T[] {
    const name = (e: T) => e.short ?? e.title;
    return [...epics].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (a.rank ?? Infinity) - (b.rank ?? Infinity) || name(a).localeCompare(name(b), undefined, { sensitivity: "base" }));
}

// One epic a place up or down among the open ones: every open epic gets its place as its rank,
// so the order you made stays put when an epic is added or finished.
export function moveEpic<T extends Pick<Epic, "id" | "title" | "short" | "pinned" | "rank">>(open: T[], id: string, by: 1 | -1): Map<string, number> | undefined {
    const list = orderEpics(open);
    const i = list.findIndex((e) => e.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= list.length || !!list[j].pinned !== !!list[i].pinned) return undefined;
    [list[i], list[j]] = [list[j], list[i]];
    return new Map(list.map((e, k) => [e.id, k]));
}
