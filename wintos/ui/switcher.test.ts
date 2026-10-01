import { describe, expect, test, vi } from "vitest";
import { globalStore } from "@/app/store/jotaiStore";
vi.mock("@/store/global", async () => ({ atoms: { staticTabId: (await import("jotai")).atom("a") } }));
vi.mock("./focusLog", () => ({ flog: vi.fn() }));
vi.mock("./focus", () => ({ enterProject: vi.fn(), focusArea: vi.fn() }));
import { enterProject } from "./focus";
import { setSwitchOrder, stepProject, switchTargetAtom, topProject, walkKey, walking } from "./switcher";

describe("stepProject", () => {
    const order = ["a", "b", "c"];

    test("moves down and up the ranked order", () => {
        expect(stepProject(order, "a", 1)).toBe("b");
        expect(stepProject(order, "b", -1)).toBe("a");
    });

    test("wraps at both ends", () => {
        expect(stepProject(order, "c", 1)).toBe("a");
        expect(stepProject(order, "a", -1)).toBe("c");
    });

    test("a current tab missing from the order starts at the top or bottom", () => {
        expect(stepProject(order, "x", 1)).toBe("a");
        expect(stepProject(order, "x", -1)).toBe("c");
    });

    test("an empty order has nowhere to go", () => {
        expect(stepProject([], "a", 1)).toBeUndefined();
    });
});

describe("walkKey", () => {
    const key = (key: string, cmd = true) => ({ key, cmd });

    test("no walk: every key goes on as usual", () => {
        globalStore.set(switchTargetAtom, null);
        expect([walkKey(key("h")), walkKey(key("Escape", false))]).toEqual([false, false]);
    });

    test("walking: ⌘J/⌘K walk on, any other ⌘ key is swallowed, plain keys go on", () => {
        globalStore.set(switchTargetAtom, "b");
        expect([walkKey(key("j")), walkKey(key("K")), walkKey(key("h")), walkKey(key("l"))]).toEqual([false, false, true, true]);
        expect(walking()).toBe(true);
    });

    test("walking: a key without ⌘ means the release was missed: switch, and the key goes on", () => {
        vi.stubGlobal("window", new EventTarget());
        vi.stubGlobal("document", new EventTarget());
        globalStore.set(switchTargetAtom, "b");
        expect(walkKey(key("x", false))).toBe(false);
        expect(walking()).toBe(false);
        expect(enterProject).toHaveBeenCalledWith("b");
    });

    test("walking: Esc ends the walk", () => {
        vi.stubGlobal("window", new EventTarget());
        vi.stubGlobal("document", new EventTarget());
        globalStore.set(switchTargetAtom, "b");
        expect(walkKey(key("Escape", false))).toBe(true);
        expect(walking()).toBe(false);
    });
});

describe("topProject", () => {
    test("the uppermost project in the sidebar, other than the one closing", () => {
        setSwitchOrder(["a", "b", "c"]);
        expect([topProject("a"), topProject("b")]).toEqual(["b", "a"]);
    });

    test("none left: undefined", () => {
        setSwitchOrder(["a"]);
        expect(topProject("a")).toBeUndefined();
    });
});
