import { expect, test } from "vitest";
import { byEpic } from "./Standup";
import type { WintosState } from "./view";

test("the daily names each item's epic and keeps an epic's items together", () => {
    const state = {
        projects: [{ id: "t1", title: "Drafts view" }, { id: "t2", title: "Export view" }, { id: "t3", title: "Loose" }],
        sessions: [{ id: "a", tabId: "t1", epic: "route" }, { id: "b", tabId: "t2", epic: "route" }],
        epics: [{ id: "route", title: "Route documents", short: "Route DO" }],
    } as unknown as WintosState;
    const items = [{ project: "Drafts view", text: "a" }, { project: "Loose", text: "b" }, { project: "Export view", text: "c" }];
    expect(byEpic(items, state)).toEqual([{ project: "Route DO", text: "a" }, { project: "Route DO", text: "c" }, { project: "Loose", text: "b" }]);
});
