import { expect, test } from "vitest";
import { dayNumbers, promptTimes } from "./numbers";

const MIN = 60_000;
const p = (m: number, sessionId: string) => ({ at: m * MIN, sessionId });

test("the longest stretch, the breaks, the switches and when you stopped", () =>
    expect(dayNumbers([p(0, "a"), p(5, "b"), p(9, "b"), p(18, "a"), p(45, "a"), p(50, "c")])).toEqual({
        prompts: 6, sessions: 3, longestMs: 18 * MIN, breaks: 1, firstAt: 0, lastAt: 50 * MIN, switchPct: 60,
    }));

test("no prompts, no numbers", () => expect(dayNumbers([])).toBeUndefined());

test("only your prompts of that day count", () => {
    const day = (t: number) => new Date(t).toISOString().slice(0, 10);
    const jsonl = [
        { type: "user", timestamp: "2026-10-29T08:00:00Z", message: { content: "fix it" } },
        { type: "user", timestamp: "2026-10-29T08:01:00Z", message: { content: "<task-notification>x" } },
        { type: "user", timestamp: "2026-10-29T08:02:00Z", isMeta: true, message: { content: "meta" } },
        { type: "user", timestamp: "2026-10-29T08:03:00Z", message: { content: [{ type: "tool_result" }] } },
        { type: "user", timestamp: "2026-10-30T08:00:00Z", message: { content: "next day" } },
    ].map((e) => JSON.stringify(e)).join("\n");
    expect(promptTimes(jsonl, "2026-10-29", day)).toEqual([Date.parse("2026-10-29T08:00:00Z")]);
});
