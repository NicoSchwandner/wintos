import { describe, expect, test, vi } from "vitest";
import { globalStore } from "@/app/store/jotaiStore";
import { blockDefFor, focusedPageUrl, newSessionScript, paneShowing, wintosClose } from "./menu";
import { mainViewAtom } from "./notes/state";

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
    test("⌘W in the notes view goes back to the terminals and closes nothing hidden", () => {
        vi.stubGlobal("requestAnimationFrame", () => 0);
        globalStore.set(mainViewAtom, "notes");
        expect(wintosClose()).toBe(true);
        expect(globalStore.get(mainViewAtom)).toBe("terminal");
    });

    test("in the terminals ⌘W stays Wave's close", () => {
        globalStore.set(mainViewAtom, "terminal");
        expect(wintosClose()).toBe(false);
    });
});


describe("paneShowing", () => {
    const blocks = [{ oid: "b1", meta: { view: "term" } }, { oid: "b2", meta: { view: "web", url: "https://github.com/acme/api/pull/9" } }] as unknown as Block[];

    test("a PR already open in a browser pane of the project is reused", () => expect(paneShowing(blocks, "https://github.com/acme/api/pull/9")).toBe("b2"));
    test("otherwise a new pane opens", () => expect(paneShowing(blocks, "https://github.com/acme/api/pull/10")).toBeUndefined());
});

describe("focusedPageUrl", () => {
    test("the focused pane's address when it is a browser page, else nothing", () => {
        expect(focusedPageUrl({ meta: { view: "web", url: "https://github.com/acme/api/pull/7" } } as unknown as Block)).toBe("https://github.com/acme/api/pull/7");
        expect(focusedPageUrl({ meta: { view: "term" } } as unknown as Block)).toBeUndefined();
        expect(focusedPageUrl(undefined)).toBeUndefined();
    });
});
