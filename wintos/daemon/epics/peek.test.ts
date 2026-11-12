import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { expect, test } from "vitest";
import type { Session } from "../sessions/reduce";
import { lastReply, peekText, readTail } from "./peek";

const line = (o: object) => JSON.stringify(o);

test("the last reply is the text of the last assistant message; tool calls and a cut line are skipped", () => {
    const jsonl = [
        line({ type: "assistant", message: { content: [{ type: "text", text: "First answer" }] } }),
        line({ type: "user", message: { content: "next" } }),
        line({ type: "assistant", message: { content: [{ type: "text", text: "Pushed the fix." }, { type: "tool_use", name: "Bash" }, { type: "text", text: "CI runs." }] } }),
        line({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash" }] } }),
        '{"type":"assis',
    ].join("\n");
    expect(lastReply(jsonl)).toBe("Pushed the fix.\nCI runs.");
    expect(lastReply("")).toBeUndefined();
});

test("a transcript is read from its end", () => {
    const f = join(mkdtempSync(join(tmpdir(), "peek-")), "t.jsonl");
    writeFileSync(f, line({ type: "assistant", message: { content: [{ type: "text", text: "done" }] } }));
    expect(lastReply(readTail(f)!)).toBe("done");
    expect(readTail(join(f, "missing"))).toBeUndefined();
});

test("a peek says its state, step, question with options, PRs and last reply", () => {
    const s = { id: "w", tabId: "t", blockId: "b", state: "waiting", since: 0, lastAt: 0, name: { text: "Drafts mapping", by: "model", at: 0 }, ask: { kind: "decide", text: "which id", by: "session", context: "the drafts table", options: [{ label: "DraftId", then: "one column" }, { label: "Both" }], suggestion: "DraftId" } } as Session;
    expect(peekText(s, { step: "Cutover", prs: [{ url: "https://github.com/a/b/pull/1", state: "open" }], reply: "Which id?" })).toBe(
        [
            'Drafts mapping: waiting, works the step "Cutover"',
            "asks the developer (decide): which id — about the drafts table",
            "  option 1: DraftId → one column",
            "  option 2: Both",
            "your suggestion on it: DraftId",
            "PRs: https://github.com/a/b/pull/1 (open)",
            "its last reply:\nWhich id?",
        ].join("\n")
    );
});
