import { describe, expect, test } from "vitest";
import { epicAgentInjection, epicInjection, injection } from "./inject";

describe("injection", () => {
    test("an unreadable note asks for a repair, never for a title (which would overwrite it)", () => {
        const text = injection({ id: "t", dir: "/p/x", mtime: 0, error: "no front matter" }, { text: "mine" });
        expect(text).not.toContain("wintos title");
        expect(text).toContain("/p/x/project.md is unreadable (no front matter)");
    });

    test("a titled project gets the sections its sessions keep: what is true now, no log of how it got there", () => {
        const text = injection({ id: "t", title: "X", dir: "/p/x", mtime: 0, pr: [], titleLocked: false, body: "" }, { text: "m" });
        for (const marker of ["## Goal", "## Known", "(blocking)", "no dates of when"]) expect(text).toContain(marker);
        for (const log of ["## Built", "## Decisions", "dated bullets", "newest last"]) expect(text).not.toContain(log);
    });

    test("it shows the exact front-matter lines to keep, since it only ever sees the body", () => {
        const text = injection({ id: "d3ed-tab", title: "X", dir: "/p/x", mtime: 0, pr: [], titleLocked: false, body: "" }, { text: "m" });
        expect(text).toContain("id: d3ed-tab");
    });

    test.each([
        ["a titled project", { id: "t", title: "X", dir: "/p/x", mtime: 0, pr: [], titleLocked: false, body: "" }],
        ["an untitled one", undefined],
    ])("%s is told to park a turn that ends waiting on something outside", (_n, project) => {
        expect(injection(project as never, { text: "m" })).toContain('wintos wait "');
        expect(injection(project as never, { text: "m" })).toContain("wintos done");
        expect(injection(project as never, { text: "m" })).toContain('wintos status "');
        expect(injection(project as never, { text: "m" })).toContain("wintos lane");
        expect(injection(project as never, { text: "m" })).toContain("wintos todo");
        expect(injection(project as never, { text: "m" })).toContain("wintos pr <link");
    });

    test("no project at all asks for a title", () => {
        expect(injection(undefined, { text: "mine.md is empty" })).toContain('wintos title "');
    });
});

describe("epicInjection", () => {
    const open = [{ id: "route", title: "Route documents" }, { id: "reviews", title: "Reviews" }];
    test("a session without an epic is asked which, from the open ones", () => {
        const t = epicInjection(undefined, open);
        expect(t).toContain("wintos epic <name>");
        expect(t).toContain("Route documents (route), Reviews (reviews)");
    });
    test("with no epics at all, nothing is asked", () => expect(epicInjection(undefined, [])).toBe(""));
    test("in an epic: its title, how to move, and its mine.md with what changed", () => {
        const t = epicInjection(open[0], open, { text: "cutover per group", diff: "+ cutover per group" });
        expect(t).toContain("[WintOS epic: Route documents]");
        expect(t).toContain("changed since your last prompt:\n+ cutover per group");
        expect(t).toContain("mine.md (the developer's; read it, never write it):\ncutover per group");
    });
    test("a session in an epic is told the open steps to claim one; none when it has claimed one", () => {
        expect(epicInjection({ ...open[0], steps: ["Cutover", "Backfill"] }, open)).toContain("steps still open: Cutover · Backfill. If your work is one of them, run `wintos unit start <step>`");
        expect(epicInjection({ ...open[0], steps: [] }, open)).not.toContain("steps still open");
    });
    test("a session in an epic is told what a relayed prompt is, and that the agent's note approves nothing", () => {
        const t = epicInjection(open[0], open);
        expect(t).toContain("`[You, via the … agent]` is the developer's own words");
        expect(t).toContain("never an approval");
    });
    test("an empty mine.md is left out", () => expect(epicInjection(open[0], open, { text: "  " })).not.toContain("mine.md"));
});

describe("epicAgentInjection", () => {
    test("tells the agent its job, where the plan and notes go, and what each session is doing", () => {
        const t = epicAgentInjection({ title: "Route documents", dir: "/e/route", steps: "[x] Intake | [>] Drafts" }, [
            { name: "Drafts mapping", state: "waiting", step: "Build", status: "tests green", prs: ["acme/api#42"], ask: "Use DraftId?" },
            { name: "Export check", state: "working", prs: [] },
        ]);
        expect(t).toContain("[WintOS epic agent: Route documents]");
        expect(t).toContain("/e/route/epic.md");
        expect(t).toContain("/e/route/notes/<YYYY-MM-DD>-<topic>.md");
        expect(t).toContain("now: [x] Intake | [>] Drafts");
        expect(t).toContain("- Drafts mapping: waiting, at Build · tests green · asks: Use DraftId? · acme/api#42");
        expect(t).toContain("- Export check: working");
        expect(t).toContain("[WintOS report]");
        expect(t).toContain("wintos suggest <session>");
        expect(t).toContain("wintos relay <session>");
        expect(t).toContain("roadmap edited by the developer");
    });
    test("with no sessions open, it says so", () => expect(epicAgentInjection({ title: "R", dir: "/e", steps: "" }, [])).toContain("- none open"));
    test("an empty roadmap is set before anything else; a set one is left to the agent", () => {
        expect(epicAgentInjection({ title: "R", dir: "/e", steps: "" }, [])).toContain("It is empty: before anything else this turn, set one");
        expect(epicAgentInjection({ title: "R", dir: "/e", steps: "[ ] A" }, [])).not.toContain("It is empty");
    });
});
