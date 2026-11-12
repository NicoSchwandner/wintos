import { expect, test } from "vitest";
import { workedFocus } from "./worked";

test("the day's steps under their epics, in the order first worked on, steps in no epic last", () =>
    expect(
        workedFocus([
            { step: "Fix the export", epic: undefined },
            { step: "Drafts mapping", epic: "Route DO" },
            { step: "Core #42", epic: "Reviews" },
            { step: "Dark launch", epic: "Route DO" },
            { step: "Drafts mapping", epic: "Route DO" },
        ])
    ).toBe("- Route DO\n  - Drafts mapping\n  - Dark launch\n- Reviews\n  - Core #42\n- Outside the epics\n  - Fix the export"));

test("nothing worked on: nothing written", () => expect(workedFocus([])).toBe(""));
