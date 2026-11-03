import { describe, expect, test } from "vitest";
import { doneUnit, parseUnits, serializeUnits, setUnits, startUnit, type Unit } from "./units";

const u = (name: string, state: Unit["state"] = "todo"): Unit => ({ name, state });

describe("units in project.md", () => {
    test("one line: [x] done, [>] current, [ ] to do, split on |", () => {
        const line = "[x] ABC-41 fields check | [>] ABC-42 phase 1 | [ ] ABC-43 match log";
        const units = [u("ABC-41 fields check", "done"), u("ABC-42 phase 1", "current"), u("ABC-43 match log")];
        expect(parseUnits(line)).toEqual(units);
        expect(serializeUnits(units)).toBe(line);
    });
    test("an entry without a box is to do; empty entries are dropped", () => {
        expect(parseUnits("ABC-1 | | [X] ABC-2")).toEqual([u("ABC-1"), u("ABC-2", "done")]);
    });
});

describe("the unit commands", () => {
    const list = [u("ABC-41 fields check", "done"), u("ABC-42 phase 1", "current"), u("ABC-43 match log")];
    test("setting the list keeps what each named unit already was; new ones are to do", () => {
        expect(setUnits(list, ["ABC-42 phase 1", "ABC-44 rollout", "ABC-41 fields check"])).toEqual([u("ABC-42 phase 1", "current"), u("ABC-44 rollout"), u("ABC-41 fields check", "done")]);
    });
    test("start: by name or its start, any case; the one current before goes back to to do", () => {
        expect(startUnit(list, "abc-43")).toEqual([list[0], u("ABC-42 phase 1"), u("ABC-43 match log", "current")]);
        expect(startUnit(list, "ABC-41 fields check")?.map((x) => x.state)).toEqual(["current", "todo", "todo"]);
        expect(startUnit(list, "ABC-9")).toBeUndefined();
    });
    test("an exact name wins over a longer one it starts", () => {
        expect(startUnit([u("ABC-1 b"), u("ABC-1")], "ABC-1")?.map((x) => x.state)).toEqual(["todo", "current"]);
    });
    test("done: ticks it, current or not", () => {
        expect(doneUnit(list, "ABC-42")?.map((x) => x.state)).toEqual(["done", "done", "todo"]);
        expect(doneUnit(list, "ABC-43")?.map((x) => x.state)).toEqual(["done", "current", "done"]);
        expect(doneUnit(list, "nope")).toBeUndefined();
    });
});
