import { expect, test } from "vitest";
import type { Row } from "../daemon/ranking/rank";
import type { Session } from "../daemon/sessions/reduce";
import { groupByEpic } from "./EpicGroups";
import type { EpicView } from "./view";

const row = (id: string, band: Row["band"], epic?: string): Row => ({ key: `s:${id}`, tabId: "t", band, lastAt: 0, sessions: [{ id, epic } as Session] });
const tabRow: Row = { key: "t9", tabId: "t9", band: "quiet", lastAt: 0, sessions: [] };
const e = (id: string, more: Partial<EpicView> = {}) => ({ id, title: id, steps: [], dir: "", mtime: 0, mineMtime: 0, ...more }) as EpicView;

test("pinned epics first, then by what waits on you; sessions in no epic and bare tabs last", () => {
    const groups = groupByEpic([row("a", "quiet", "quietish"), row("b", "needs", "urgent"), row("c", "running", "pinned"), row("d", "needs"), tabRow], [e("quietish"), e("urgent"), e("pinned", { pinned: true }), e("empty")]);
    expect(groups.map((g) => g.epic?.id ?? "outside")).toEqual(["pinned", "urgent", "quietish", "empty", "outside"]);
    expect(groups.at(-1)!.rows.map((r) => r.key)).toEqual(["s:d", "t9"]);
});

test("a done epic has no group; its sessions go outside", () => {
    const groups = groupByEpic([row("a", "quiet", "old")], [e("old", { done: "2026-11-01" })]);
    expect(groups.map((g) => g.epic?.id ?? "outside")).toEqual(["outside"]);
});

test("the epic agent's row is its epic's header, not a row under it nor outside; its wait ranks the epic", () => {
    const groups = groupByEpic([row("w", "quiet", "e1"), row("ag", "needs", "e1"), row("x", "running", "e2")], [e("e2"), e("e1", { agent: "ag" })]);
    expect(groups.map((g) => g.epic?.id)).toEqual(["e1", "e2"]);
    expect(groups[0].rows.map((r) => r.key)).toEqual(["s:w"]);
    expect(groups[0].agent?.key).toBe("s:ag");
    expect(groups.some((g) => !g.epic)).toBe(false);
});
