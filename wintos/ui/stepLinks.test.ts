import { expect, test } from "vitest";
import type { Session } from "../daemon/sessions/reduce";
import { stepSessions } from "./stepLinks";

const s = (id: string, prs: string[], more: Partial<Session> = {}) => ({ id, tabId: "t", blockId: `b-${id}`, state: "idle", since: 0, lastAt: 0, epic: "e", prs, ...more }) as Session;
const pr = "https://github.com/acme/Core/pull/14715";

test("a step naming a PR leads to the epic's open session owning it, after the linked ones", () => {
    expect(stepSessions("Core#14715 on test + E2E walk", ["w1"], [s("w2", [pr]), s("w3", ["https://github.com/acme/Core/pull/1"])], { id: "e" })).toEqual(["w1", "w2"]);
    expect(stepSessions("core #14715 merged", [], [s("w2", [pr])], { id: "e" })).toEqual(["w2"]);
});

test("never the agent, an ended session or another epic's; a step naming no PR has only its links", () => {
    expect(stepSessions("Core#14715 merged", ["ag"], [s("ag", [pr]), s("old", [pr], { state: "ended" }), s("x", [pr], { epic: "other" })], { id: "e", agent: "ag" })).toEqual([]);
    expect(stepSessions("Receipt routines seed", ["w1"], [s("w2", [pr])], { id: "e" })).toEqual(["w1"]);
});
