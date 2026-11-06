import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { expect, test } from "vitest";
import { eventLog } from "./events";

test("one JSON line per event, in the day's file", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "ev-")), ".events");
    const at = new Date(2026, 10, 5, 9, 30).getTime();
    const log = eventLog(dir, () => at);
    log("session", { id: "s1", cause: "hook Stop", changes: ["state working → waiting"] });
    log("report", { agent: "a1", text: "done" });
    const lines = readFileSync(join(dir, "2026-11-05.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toEqual([
        { at: new Date(at).toISOString(), kind: "session", id: "s1", cause: "hook Stop", changes: ["state working → waiting"] },
        { at: new Date(at).toISOString(), kind: "report", agent: "a1", text: "done" },
    ]);
});

test("a log it cannot write is dropped, never thrown", () => {
    const file = join(mkdtempSync(join(tmpdir(), "ev-")), "a-file");
    writeFileSync(file, "");
    expect(() => eventLog(join(file, "events"))("session", { id: "s1" })).not.toThrow();
});
