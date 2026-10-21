import { expect, test } from "vitest";
import { deliverable } from "./wakes";

const wake = { sessionId: "s", pr: "https://github.com/o/r/pull/7", until: "released" as const, prompt: "check prod", at: 0, expires: 9, due: 5 };
const session = (o = {}) => ({ id: "s", tabId: "t", blockId: "b", state: "parked", since: 0, lastAt: 0, ...o }) as never;

test("a due wake goes to its session's pane in its own tab, between turns only", () => {
    expect(deliverable({ s: wake }, [session()], "t")).toEqual([{ sessionId: "s", blockId: "b", text: "[WintOS wake: o/r#7 is released] check prod" }]);
    expect(deliverable({ s: wake }, [session()], "other")).toEqual([]);
    expect(deliverable({ s: wake }, [session({ state: "working" })], "t")).toEqual([]);
    expect(deliverable({ s: wake }, [session({ state: "ended" })], "t")).toEqual([]);
    expect(deliverable({ s: { ...wake, due: undefined } }, [session()], "t")).toEqual([]);
    expect(deliverable({ s: wake }, [], "t")).toEqual([]);
});
