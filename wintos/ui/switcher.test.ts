import { describe, expect, test, vi } from "vitest";
import { globalStore } from "@/app/store/jotaiStore";
vi.mock("./focusLog", () => ({ flog: vi.fn() }));
const here = { tab: "a" };
vi.mock("./focus", () => ({ enterProject: vi.fn(), focusArea: vi.fn(), whereYouAre: () => here.tab }));
import { enterProject } from "./focus";
import { setSwitchOrder, stepProject, switchProject, switchTargetAtom, topProject, undoWalkKey, walkKey, walking } from "./switcher";

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

describe("switchProject starts from where you are", () => {
    test("in a project, the next one after it", () => {
        setSwitchOrder(["a", "b", "c"]);
        here.tab = "b";
        globalStore.set(switchTargetAtom, null);
        switchProject(1, false);
        expect(enterProject).toHaveBeenLastCalledWith("c");
    });

    test("on a page over the project (Today), from outside the list: ⌘J the first, ⌘K the last", () => {
        setSwitchOrder(["a", "b", "c"]);
        here.tab = "";
        globalStore.set(switchTargetAtom, null);
        switchProject(1, false);
        expect(enterProject).toHaveBeenLastCalledWith("a");
        switchProject(-1, false);
        expect(enterProject).toHaveBeenLastCalledWith("c");
    });
});

describe("undoWalkKey", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
    const walkTo = (to: string) => (setSwitchOrder(["a", to]), (here.tab = "a"), switchProject(1, false));
    const esc = { key: "Escape" };

    test("Esc right after a walk lands goes back where it started, once", () => {
        walkTo("b");
        vi.mocked(enterProject).mockClear();
        expect(undoWalkKey(esc)).toBe(true);
        expect(enterProject).toHaveBeenCalledWith("a");
        expect(undoWalkKey(esc)).toBe(false);
    });

    test("too late, or another key: Esc is just Esc", () => {
        walkTo("b");
        expect(undoWalkKey({ key: "Escape", cmd: true })).toBe(false);
        vi.useFakeTimers({ now: Date.now() + 2000 });
        expect(undoWalkKey(esc)).toBe(false);
        vi.useRealTimers();
    });
});
