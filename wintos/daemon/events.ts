import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import { localDay } from "./recap/recap";

// What happened and why, one JSON line per event in a file per day: session changes with their
// cause, reports to epic agents, roadmap edits, focus. For reading back why a session was your
// move and what ended it. It never fails what it records: a write error is dropped.
export type EventLog = (kind: string, data: Record<string, unknown>) => void;

export function eventLog(dir: string, now: () => number = Date.now): EventLog {
    return (kind, data) => {
        try {
            const t = now();
            mkdirSync(dir, { recursive: true });
            appendFileSync(join(dir, `${localDay(t)}.jsonl`), JSON.stringify({ at: new Date(t).toISOString(), kind, ...data }) + "\n");
        } catch {
            // fail-open: the log is never why a request fails
        }
    };
}
