import { describe, expect, test } from "vitest";
import { namePrompt, nameKey, userPrompts } from "./naming";

const line = (o: object) => JSON.stringify(o);

describe("userPrompts", () => {
    test("only what the developer typed: no tool results, no harness messages, pastes folded", () => {
        const jsonl = [
            line({ type: "user", message: { content: "Fix the retention backfill" } }),
            line({ type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } }),
            line({ type: "user", isMeta: true, message: { content: "Caveat: local commands" } }),
            line({ type: "user", message: { content: "<command-name>/clear</command-name>" } }),
            line({ type: "assistant", message: { content: "Done." } }),
            line({ type: "user", message: { content: 'look at this <pasted_content id="1">a\nlong\ntrace</pasted_content id="1"> please' } }),
            "not json",
        ].join("\n");
        expect(userPrompts(jsonl)).toEqual(["Fix the retention backfill", "look at this [pasted] please"]);
    });

    test("a long session keeps its first three and last three", () => {
        const jsonl = Array.from({ length: 10 }, (_, i) => line({ type: "user", message: { content: `p${i}` } })).join("\n");
        expect(userPrompts(jsonl)).toEqual(["p0", "p1", "p2", "p7", "p8", "p9"]);
    });
});

describe("namePrompt and nameKey", () => {
    test("asks for the concrete thing, with what it has to go on", () => {
        const p = namePrompt({ project: "BSS smoke tests", prompts: ["Fix the retention backfill"], prs: ["#108 Backfill the DMS voucher history"], lane: "feature", branch: "dms-retention" });
        expect(p).toContain("Leave out the\nproject's own name");
        expect(p).toContain("Project: BSS smoke tests");
        expect(p).toContain("- #108 Backfill the DMS voucher history");
        expect(p).toContain("- Fix the retention backfill");
    });

    test("changes when its PRs or lane do", () => {
        const s = { id: "s", tabId: "t", blockId: "b", state: "working" as const, since: 0, lastAt: 0 };
        expect(nameKey({ ...s, prs: ["a"] })).not.toBe(nameKey({ ...s, prs: ["a", "b"] }));
        expect(nameKey({ ...s, lane: { name: "fast", steps: [], at: 0 } })).not.toBe(nameKey(s));
    });
});
