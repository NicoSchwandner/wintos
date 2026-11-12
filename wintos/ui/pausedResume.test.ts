import { expect, test, vi } from "vitest";

import { pausedHere } from "./pausedResume";

vi.mock("./typeIntoPane", () => ({ typeIntoPane: async () => {} }));

const s = (o = {}) => ({ id: "s", tabId: "t", blockId: "b", state: "idle", since: 0, lastAt: 0, cwd: "/w", ...o }) as never;

test("pausedHere: the paused session in the pane you are at, with the line that resumes it; none otherwise", () => {
    expect(pausedHere([s({ paused: 1, restored: true })], "t", "b")).toEqual({ id: "s", script: "cd '/w' && claude --resume 's'" });
    expect(pausedHere([s({ paused: 1, restored: true, resume: "claude --resume 's' --model x" })], "t", "b")?.script).toBe("claude --resume 's' --model x");
    expect(pausedHere([s()], "t", "b")).toBeUndefined();
    expect(pausedHere([s({ restored: true })], "t", "b")).toBeUndefined(); // restored by a restart: its pane resumes it itself
    expect(pausedHere([s({ paused: 1 })], "t", "other")).toBeUndefined();
    expect(pausedHere([s({ paused: 1 })], "t2", "b")).toBeUndefined();
});
