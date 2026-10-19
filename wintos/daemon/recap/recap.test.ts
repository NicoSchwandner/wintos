import { describe, expect, test } from "vitest";
import { activeMinutes, cutBullets, mergeByTitle, prFact, lastRecaps, lastWorkday, localDay, parseBullets, recordActivity, recapPrompt, type Activity } from "./recap";

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
    test("any day: the latest", () => expect(lastRecaps(jsonl, "")).toBe("Today's."));
    test("none that day", () => expect(lastRecaps(jsonl, "2026-10-05")).toBeUndefined());
});

describe("bullets", () => {
    const items = [
        { title: "Idea skill", minutes: 45, prompts: 22, recaps: ["We're merging the fast and shape lanes into one idea skill (PR #1403). Next, relaunch the run."], facts: ["acme/rules#1403 Merge the lanes into one idea skill (yours, opened today, draft)"] },
        { title: "Missing documents", minutes: 30, prompts: 16, recaps: ["We're closing DEV-29895 gaps where the action already exists but the routine is missing, and more text after that to be cut."], facts: [] },
    ];
    test("without a summarizer: one per project, its recap's first sentence, no ticket ids, short", () =>
        expect(cutBullets(items)).toEqual([
            "Idea skill: We're merging the fast and shape lanes into one idea skill (PR #1403).",
            "Missing documents: We're closing gaps where the action already exists but the routine is missing, and more…",
        ]));
    test("a summarizer's answer: its bullet lines, as many as there were chunks of work, ticket ids gone", () =>
        expect(parseBullets("Here you go:\n- A: one\n- B: two (DEV-123)\n* C: three\n- D\n- E\n- F\n")).toEqual(["A: one", "B: two", "C: three", "D", "E", "F"]));
    test("its kind headings stay, as entries of their own; one with no bullet under it goes", () =>
        expect(parseBullets("## Product work\n- A: one\n- B: two\n## Support\n## Team tooling\n- C: three\n")).toEqual(["## Product work", "A: one", "B: two", "## Team tooling", "C: three"]));
    test("an extra instruction (another source to search) rides along, with the day filled in", () =>
        expect(recapPrompt("2026-10-06", items, "Also search chat for what I sent on {day}.")).toContain("Also search chat for what I sent on 2026-10-06."));
    test("the prompt weighs by time, carries each project's PR facts, and sets the standup's rules", () => {
        const p = recapPrompt("2026-10-06", items);
        expect(p).toContain("## Idea skill (45 min)");
        expect(p).toContain("- PR acme/rules#1403 Merge the lanes into one idea skill (yours, opened today, draft)");
        for (const rule of ["most time first", "only the developer uses", "team tooling", "CI", "Review race", "ticket", "## Product work", "## Support", "## Team tooling"]) expect(p).toContain(rule);
    });
});

describe("activeMinutes", () => {
    const at = (iso: string) => JSON.stringify({ type: "assistant", timestamp: iso });
    test("the time a session was busy on a day: gaps over five minutes are breaks, other days don't count", () => {
        const jsonl = [at("2026-10-16T08:00:00Z"), at("2026-10-16T08:04:00Z"), at("2026-10-16T08:30:00Z"), at("2026-10-16T08:31:00Z"), at("2026-10-15T08:00:00Z"), "junk"].join("\n");
        expect(activeMinutes(jsonl, localDay(Date.parse("2026-10-16T08:00:00Z")))).toBe(5);
    });
});

describe("lastWorkday", () => {
    test("Monday reads Friday, not a Saturday with sessions in it", () => expect(lastWorkday(["2026-10-08", "2026-10-09", "2026-10-10"], "2026-10-12")).toBe("2026-10-09"));
    test("never today, and nothing when only weekends are left", () => {
        expect(lastWorkday(["2026-10-09"], "2026-10-09")).toBeUndefined();
        expect(lastWorkday(["2026-10-10", "2026-10-11"], "2026-10-12")).toBeUndefined();
    });
});

describe("prFact", () => {
    const pr = { repo: "acme/api", number: 7, title: "Show large PDFs", author: "me", isDraft: false, createdAt: "2026-10-01T08:00:00Z" } as never as import("../prs/group").PR;
    const day = localDay(Date.parse("2026-10-16T10:00:00Z"));
    test("whose it is and where it got to that day", () => {
        expect(prFact(pr, "me", day)).toBe("acme/api#7 Show large PDFs (yours, ready for review)");
        expect(prFact({ ...pr, author: "ana", mergedAt: "2026-10-16T10:00:00Z" }, "me", day)).toBe("acme/api#7 Show large PDFs (by ana, merged today)");
        expect(prFact({ ...pr, isDraft: true, createdAt: "2026-10-16T09:00:00Z" }, "me", day)).toBe("acme/api#7 Show large PDFs (yours, opened today, draft)");
    });
});

describe("mergeByTitle", () => {
    test("a project recorded under two tabs is one item, its time added up", () => {
        const i = (minutes: number, facts: string[]) => ({ title: "Same", minutes, prompts: 1, recaps: [`r${minutes}`], facts });
        expect(mergeByTitle([i(10, ["a"]), i(5, ["a", "b"]), { ...i(3, []), title: "Other" }])).toEqual([{ title: "Same", minutes: 15, prompts: 2, recaps: ["r10", "r5"], facts: ["a", "b"], asked: [] }, { ...i(3, []), title: "Other" }]);
    });
});
