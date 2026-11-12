import { expect, test } from "vitest";
import type { Session } from "../daemon/sessions/reduce";
import { canTypeInto } from "./outbox";

const s = (more: Partial<Session> = {}) => ({ id: "s", tabId: "t", blockId: "b", state: "waiting", since: 0, lastAt: 0, ...more }) as Session;

test("text goes into a running session's pane in this tab, not at work, and not the pane you are in", () => {
    expect(canTypeInto(s(), "t")).toBe(true);
    expect(canTypeInto(s(), "t", "b")).toBe(false);
    expect(canTypeInto(s(), "other")).toBe(false);
    for (const more of [{ state: "working" }, { state: "ended" }, { restored: true }, { blockId: "" }, { bgId: "430f7f7e" }] as Partial<Session>[]) expect(canTypeInto(s(more), "t")).toBe(false);
    expect(canTypeInto(s({ bgId: "430f7f7e", attachedTo: "b" }), "t")).toBe(true);
    expect(canTypeInto(undefined, "t")).toBe(false);
});
