import { describe, expect, test, vi } from "vitest";
import { globalStore } from "@/app/store/jotaiStore";
import { blockDefFor, newSessionScript, paneShowing, runKey, wintosClose } from "./menu";
import { mainViewAtom, prTabsAtom } from "./notes/state";

const widgets = {
    "defwidget@terminal": { blockdef: { meta: { view: "term", controller: "shell" } } },
    "defwidget@web": { blockdef: { meta: { view: "web" } } },
    "defwidget@files": { blockdef: { meta: { view: "preview", file: "~" } } },
} as unknown as Record<string, WidgetConfigType>;

describe("blockDefFor", () => {
    test("menu actions open the same blocks the widget bar did", () => {
        expect(blockDefFor("browser", widgets)).toEqual({ def: { meta: { view: "web" } }, ephemeral: false });
        expect(blockDefFor("files", widgets)).toEqual({ def: { meta: { view: "preview", file: "~" } }, ephemeral: false });
    });

    test("settings opens the config view as a transient block", () => {
        expect(blockDefFor("settings", widgets)).toEqual({ def: { meta: { view: "waveconfig" } }, ephemeral: true });
    });

    test("a widget the user removed from config opens nothing", () => {
        expect(blockDefFor("processes", widgets)).toBeNull();
    });

    test("an unknown action opens nothing", () => {
        expect(blockDefFor("bogus", widgets)).toBeNull();
    });
});

describe("newSessionScript", () => {
    test("starts Claude in the focused session's directory, safely quoted", () => {
        expect(newSessionScript("/Users/n/it's here")).toBe("cd '/Users/n/it'\\''s here' && claude");
    });

    test("with no session to copy from it just starts Claude", () => {
        expect(newSessionScript(undefined)).toBe("claude");
    });
});

describe("wintosClose", () => {
    test("⌘W with PRs open beside the queue closes the shown tab, not a hidden pane", () => {
        vi.stubGlobal("document", { querySelector: () => null });
        globalStore.set(mainViewAtom, "prs");
        globalStore.set(prTabsAtom, { urls: ["https://github.com/acme/api/pull/1", "https://github.com/acme/api/pull/2"], active: 1 });
        expect(wintosClose()).toBe(true);
        expect(globalStore.get(prTabsAtom)).toEqual({ urls: ["https://github.com/acme/api/pull/1"], active: 0 });
    });

    test("in the terminals ⌘W stays Wave's close", () => {
        globalStore.set(mainViewAtom, "terminal");
        expect(wintosClose()).toBe(false);
    });
});

describe("runKey for the PR browser", () => {
    test("⇧⌘C copies the shown tab's current address", async () => {
        // Through emain: navigator.clipboard refuses while the focus is inside the page.
        const writeText = vi.fn();
        vi.stubGlobal("window", { api: { writeClipboard: writeText } });
        vi.stubGlobal("document", { querySelector: () => ({ getURL: () => "https://github.com/acme/api/pull/2/files" }) });
        globalStore.set(mainViewAtom, "prs");
        globalStore.set(prTabsAtom, { urls: ["https://github.com/acme/api/pull/2"], active: 0 });
        expect(runKey("browser-copy-url")).toBe(true);
        expect(writeText).toHaveBeenCalledWith("https://github.com/acme/api/pull/2/files");
    });

    test("⌥⌘→ steps the PR tabs while the queue is shown", () => {
        globalStore.set(mainViewAtom, "prs");
        globalStore.set(prTabsAtom, { urls: ["https://github.com/acme/api/pull/1", "https://github.com/acme/api/pull/2"], active: 0 });
        expect(runKey("tab-next")).toBe(true);
        expect(globalStore.get(prTabsAtom).active).toBe(1);
    });

    test("elsewhere ⌘← and ⌥⌘← stay the terminal's and Wave's", () => {
        globalStore.set(mainViewAtom, "terminal");
        expect(runKey("browser-back")).toBe(false);
        expect(runKey("tab-prev")).toBe(false);
        expect(runKey("browser-copy-url")).toBe(false);
    });
});

describe("paneShowing", () => {
    const blocks = [{ oid: "b1", meta: { view: "term" } }, { oid: "b2", meta: { view: "web", url: "https://github.com/acme/api/pull/9" } }] as unknown as Block[];

    test("a PR already open in a browser pane of the project is reused", () => expect(paneShowing(blocks, "https://github.com/acme/api/pull/9")).toBe("b2"));
    test("otherwise a new pane opens", () => expect(paneShowing(blocks, "https://github.com/acme/api/pull/10")).toBeUndefined());
});
