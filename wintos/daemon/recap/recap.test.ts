import { describe, expect, test } from "vitest";
import { cutBullets, lastRecaps, parseBullets, recordActivity, recapPrompt, type Activity } from "./recap";

describe("recordActivity", () => {
    test("a session's project and transcript, per day; prompts counted; old days dropped", () => {
        let a: Activity = { "2026-09-01": {} };
        a = recordActivity(a, "2026-10-06", "tab1", "Idea skill", "s1", "/t/s1.jsonl", true, 14);
        a = recordActivity(a, "2026-10-06", "tab1", "Idea skill", "s1", "/t/s1.jsonl", false, 14);
        a = recordActivity(a, "2026-10-06", "tab1", "Idea skill", "s2", "/t/s2.jsonl", true, 14);
        expect(a).toEqual({ "2026-10-06": { tab1: { title: "Idea skill", prompts: 2, sessions: { s1: "/t/s1.jsonl", s2: "/t/s2.jsonl" } } } });
    });
});

describe("lastRecaps", () => {
    const line = (ts: string, extra: object) => JSON.stringify({ timestamp: ts, ...extra });
    const jsonl = [
        line("2026-10-06T09:00:00Z", { type: "system", subtype: "away_summary", content: "Early one." }),
        line("2026-10-06T15:00:00Z", { type: "system", subtype: "away_summary", content: "We merged the lanes. Next, rerun the test." }),
        line("2026-10-07T08:00:00Z", { type: "system", subtype: "away_summary", content: "Today's." }),
        "not json",
    ].join("\n");
    test("the day's last recap of a transcript", () => expect(lastRecaps(jsonl, "2026-10-06")).toBe("We merged the lanes. Next, rerun the test."));
    test("none that day", () => expect(lastRecaps(jsonl, "2026-10-05")).toBeUndefined());
});

describe("bullets", () => {
    const items = [
        { title: "Idea skill", prompts: 22, recaps: ["We're merging the fast and shape lanes into one idea skill (PR #1403). Next, relaunch the run."] },
        { title: "Missing documents", prompts: 16, recaps: ["We're closing DEV-29895 gaps where the action already exists but the routine is missing, and more text after that to be cut."] },
    ];
    test("without a summarizer: one per project, its recap's first sentence, no ticket ids, short", () =>
        expect(cutBullets(items)).toEqual([
            "Idea skill: We're merging the fast and shape lanes into one idea skill (PR #1403).",
            "Missing documents: We're closing gaps where the action already exists but the routine is missing, and more…",
        ]));
    test("a summarizer's answer: its bullet lines, at most five, ticket ids gone", () =>
        expect(parseBullets("Here you go:\n- A: one\n- B: two (DEV-123)\n* C: three\n- D\n- E\n- F\n")).toEqual(["A: one", "B: two", "C: three", "D", "E"]));
    test("an extra instruction (another source to search) rides along, with the day filled in", () =>
        expect(recapPrompt("2026-10-06", items, "Also search chat for what I sent on {day}.")).toContain("Also search chat for what I sent on 2026-10-06."));
    test("the prompt names the projects and the rules", () => {
        const p = recapPrompt("2026-10-06", items);
        expect(p).toContain("Idea skill (22 prompts)");
        expect(p).toContain("at most 5");
        expect(p).toContain("ticket");
    });
});
