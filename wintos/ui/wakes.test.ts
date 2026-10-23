import { expect, test } from "vitest";
import { closedWakes, deliverable, resumes } from "./wakes";

const wake = { sessionId: "s", pr: "https://github.com/o/r/pull/7", until: "released" as const, prompt: "check prod", at: 0, expires: 9, due: 5 };
const session = (o = {}) => ({ id: "s", tabId: "t", blockId: "b", state: "parked", since: 0, lastAt: 0, ...o }) as never;
const shelved = { sessionId: "s", script: "cd '/w' && claude --resume 's'", label: "x", at: 0 };

test("a due wake goes to its session's pane in its own tab, between turns only", () => {
    expect(deliverable({ s: wake }, [session()], [], "t")).toEqual([{ kind: "type", sessionId: "s", blockId: "b", text: "[WintOS wake: o/r#7 is released] check prod" }]);
    expect(deliverable({ s: wake }, [session()], [], "other")).toEqual([]);
    expect(deliverable({ s: wake }, [session({ state: "working" })], [], "t")).toEqual([]);
    expect(deliverable({ s: { ...wake, due: undefined } }, [session()], [], "t")).toEqual([]);
});

test("a shelved session in this tab is resumed first; an ended one counts as shelved", () => {
    expect(deliverable({ s: wake }, [], [shelved], "t")).toEqual([{ kind: "resume", sessionId: "s", script: shelved.script }]);
    expect(deliverable({ s: wake }, [session({ state: "ended" })], [shelved], "t")).toEqual([{ kind: "resume", sessionId: "s", script: shelved.script }]);
    expect(deliverable({ s: wake }, [], [], "t")).toEqual([]);
});

test("a due wake whose project is closed waits there, named by its project and what happened", () => {
    const shelf = { closed: [shelved], open: [] };
    const projects = [{ id: "closed", title: "Self-invoice review" }];
    expect(closedWakes({ s: { ...wake, until: "rereview" } }, shelf, projects, ["open"], () => "R #7")).toEqual([
        { projectId: "closed", title: "Self-invoice review", sessionId: "s", script: shelved.script, due: 5, line: "R #7 asks for your re-review · opening it resumes the session" },
    ]);
    expect(closedWakes({ s: wake }, shelf, projects, ["closed"], () => "R #7")).toEqual([]);
    expect(closedWakes({ s: { ...wake, due: undefined } }, shelf, projects, ["open"], () => "R #7")).toEqual([]);
});

test("a pane that already resumes the session counts, so it isn't resumed twice", () => {
    expect(resumes([undefined, "cd '/w' && claude --resume 's'"], "s")).toBe(true);
    expect(resumes(["cd '/w' && claude --resume 'other'"], "s")).toBe(false);
});
