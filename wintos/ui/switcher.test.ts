import { describe, expect, test, vi } from "vitest";
import { globalStore } from "@/app/store/jotaiStore";
vi.mock("./focusLog", () => ({ flog: vi.fn() }));
const here = { tab: "a", session: undefined as { id: string; tabId: string } | undefined };
vi.mock("./focus", () => ({ enterProject: vi.fn(), focusArea: vi.fn(), whereYouAre: () => here.tab, focusedSession: () => here.session }));
import { enterProject } from "./focus";
import { setSwitchOrder, stepProject, switchProject, switchTargetAtom, topProject, toRow, undoWalkKey, walkKey, walking } from "./switcher";

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

describe("a walk among session rows", () => {
    test("starts from the focused session's row, and steps to the next session", () => {
        setSwitchOrder(["s:1", "s:2", "b"], { "s:1": "a", "s:2": "a" });
        here.tab = "a";
        here.session = { id: "2", tabId: "a" };
        vi.mocked(enterProject).mockClear();
        switchProject(1, false);
        expect(enterProject).toHaveBeenCalledWith("b");
        here.session = undefined;
    });
});

describe("topProject", () => {
    test("the uppermost project in the sidebar, other than the one closing", () => {
        setSwitchOrder(["a", "b", "c"]);
        expect([topProject("a"), topProject("b")]).toEqual(["b", "a"]);
    });

    test("the cards and closed projects' wakes above it are no projects to land on", () => {
        setSwitchOrder(["card:today", "card:prs", "wake:x", "a", "b"]);
        expect(topProject("a")).toBe("b");
    });

    test("none left: undefined", () => {
        setSwitchOrder(["a"]);
        expect(topProject("a")).toBeUndefined();
    });

    test("a session's row lands on its tab; the closing tab's sessions are skipped", () => {
        setSwitchOrder(["card:prs", "s:1", "s:2", "c"], { "s:1": "a", "s:2": "b" });
        expect([topProject("a"), topProject("b")]).toEqual(["b", "a"]);
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

describe("a walk from a page ends on the main process's word", () => {
    test("⌘ up in the page, or a key there without ⌘, switches once", () => {
        let metaUp = () => {};
        const win = Object.assign(new EventTarget(), { api: { onWintosWalkMetaUp: (cb: () => void) => (metaUp = cb) } });
        vi.stubGlobal("window", win);
        vi.stubGlobal("document", new EventTarget());
        vi.mocked(enterProject).mockClear();
        here.tab = "a";
        setSwitchOrder(["a", "b", "c"]);
        switchProject(1, true);
        expect(walking()).toBe(true);
        metaUp();
        expect(walking()).toBe(false);
        expect(enterProject).toHaveBeenCalledExactlyOnceWith("b");
        metaUp();
        expect(enterProject).toHaveBeenCalledOnce();
    });
});

describe("⌃⇥: the rows that need you, from the top of the sidebar, switching on release", () => {
    const setup = () => {
        vi.stubGlobal("window", new EventTarget());
        vi.stubGlobal("document", new EventTarget());
        globalStore.set(switchTargetAtom, null);
        vi.mocked(enterProject).mockClear();
        // q is quiet and r only has something to read: ⌃⇥ skips both while anything needs you.
        setSwitchOrder(["card:today", "card:prs", "wake:x", "a", "q", "b", "r"], {}, ["wake:x", "a", "b"], ["r"]);
        here.tab = "b";
    };
    const release = (key: string) => window.dispatchEvent(Object.assign(new Event("keyup"), { key }));

    test("the first tap is the topmost project wherever you are, each next one goes down; only ⌃ released switches", () => {
        setup();
        switchProject(1, true, "top");
        expect(globalStore.get(switchTargetAtom)).toBe("wake:x");
        switchProject(1, true, "top");
        expect(globalStore.get(switchTargetAtom)).toBe("a");
        release("Meta");
        expect(walking()).toBe(true);
        release("Control");
        expect(walking()).toBe(false);
        expect(enterProject).toHaveBeenCalledExactlyOnceWith("a");
    });

    test("in the topmost project already, the first tap skips it to the second (⌃⇧⇥: the bottom one likewise)", () => {
        setup();
        here.tab = "wake:x";
        switchProject(1, true, "top");
        expect(globalStore.get(switchTargetAtom)).toBe("a");
        globalStore.set(switchTargetAtom, null);
        here.tab = "b";
        switchProject(-1, true, "top");
        expect(globalStore.get(switchTargetAtom)).toBe("a");
    });

    test("quiet and running rows are skipped; with nothing needing you it walks what there is to read, else stays", () => {
        setup();
        here.tab = "x";
        switchProject(1, true, "top");
        switchProject(1, true, "top");
        switchProject(1, true, "top");
        expect(globalStore.get(switchTargetAtom)).toBe("b");
        globalStore.set(switchTargetAtom, null);
        setSwitchOrder(["a", "q", "r"], {}, [], ["r"]);
        switchProject(1, true, "top");
        expect(globalStore.get(switchTargetAtom)).toBe("r");
        globalStore.set(switchTargetAtom, null);
        setSwitchOrder(["a", "q"], {}, [], []);
        switchProject(1, true, "top");
        expect(globalStore.get(switchTargetAtom)).toBeNull();
    });

    test("⌃⇧⇥ starts from the bottom, and the cards are no stops", () => {
        setup();
        here.tab = "a";
        switchProject(-1, true, "top");
        expect(globalStore.get(switchTargetAtom)).toBe("b");
        switchProject(1, true, "top");
        expect(globalStore.get(switchTargetAtom)).toBe("wake:x");
    });

    test("walking with ⌃: ⌃⇥ walks on, another ⌃ key is swallowed, a key without ⌃ switches and goes on", () => {
        setup();
        switchProject(1, true, "top");
        expect([walkKey({ key: "Tab", control: true }), walkKey({ key: "j", control: true })]).toEqual([false, true]);
        expect(walkKey({ key: "x" })).toBe(false);
        expect(enterProject).not.toHaveBeenCalled();
    });
});

describe("⌘J/⌘K and ⌥⌘1–9 count rows only", () => {
    test("⌥⌘1 is the first row, past the cards, pinned epics and a closed project's wake above it", () => {
        vi.mocked(enterProject).mockClear();
        setSwitchOrder(["card:prs", "wake:x", "epic:e", "a", "b"]);
        toRow(1);
        expect(enterProject).toHaveBeenCalledExactlyOnceWith("a");
    });
    test("⌘J walks past the cards: they have keys of their own", () => {
        vi.stubGlobal("window", new EventTarget());
        vi.stubGlobal("document", new EventTarget());
        globalStore.set(switchTargetAtom, null);
        setSwitchOrder(["card:today", "card:prs", "a", "b"]);
        here.tab = "b";
        here.session = undefined;
        switchProject(1, true);
        expect(globalStore.get(switchTargetAtom)).toBe("a");
    });
});
