import { describe, expect, test } from "vitest";
import { allowedInInbox, blockDefFor, focusedPageUrl, paneShowing, shelvable, WINTOS_KEYS } from "./menu";

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

describe("paneShowing", () => {
    const blocks = [{ oid: "b1", meta: { view: "term" } }, { oid: "b2", meta: { view: "web", url: "https://github.com/acme/api/pull/9" } }] as unknown as Block[];

    test("a PR already open in a browser pane of the project is reused", () => expect(paneShowing(blocks, "https://github.com/acme/api/pull/9")).toBe("b2"));
    test("otherwise a new pane opens", () => expect(paneShowing(blocks, "https://github.com/acme/api/pull/10")).toBeUndefined());
    test("a PR pane that moved on to its files tab is still that PR", () => {
        const moved = [{ oid: "b3", meta: { view: "web", url: "https://github.com/acme/api/pull/9/files#diff-1" } }] as unknown as Block[];
        expect(paneShowing(moved, "https://github.com/acme/api/pull/9")).toBe("b3");
        expect(paneShowing(moved, "https://github.com/acme/api/pull/90")).toBeUndefined();
    });
    test("a page that redirected (a sign-in, a viewer's own address) is still the page it was opened for", () => {
        const moved = [{ oid: "b5", meta: { view: "web", url: "https://accounts.example.com/signin?x=1", "wintos:opened": "https://errors.example.com/team/x" } }] as unknown as Block[];
        expect(paneShowing(moved, "https://errors.example.com/team/x")).toBe("b5");
    });
    test("other pages match only exactly", () =>
        expect(paneShowing([{ oid: "b4", meta: { view: "web", url: "https://example.com/a/b" } }] as unknown as Block[], "https://example.com/a")).toBeUndefined());
});

describe("focusedPageUrl", () => {
    test("the focused pane's address when it is a browser page, else nothing", () => {
        expect(focusedPageUrl({ meta: { view: "web", url: "https://github.com/acme/api/pull/7" } } as unknown as Block)).toBe("https://github.com/acme/api/pull/7");
        expect(focusedPageUrl({ meta: { view: "term" } } as unknown as Block)).toBeUndefined();
        expect(focusedPageUrl(undefined)).toBeUndefined();
    });
});

describe("allowedInInbox", () => {
    test("the Inbox opens pages and moves between them; it starts no terminals", () => {
        for (const a of ["palette", "keymap", "prs", "panel", "open-page:https://github.com/acme/api/pull/1", "switch-next", "project", "copy-url", "pane-next", "browser", "focus-left", "focus-right"]) expect([a, allowedInInbox(a)]).toEqual([a, true]);
        for (const a of ["terminal", "files", "sysinfo", "processes", "rename", "edit-mine"]) expect([a, allowedInInbox(a)]).toEqual([a, false]);
    });
});

describe("shelvable", () => {
    test("a session pane with the hook's resume command goes on the shelf", () =>
        expect(shelvable({ "cmd:initscript": "cd '/w' && claude --resume 'abc'" })).toBe("cd '/w' && claude --resume 'abc'"));
    test("a fresh session, one ended with /exit, a plain terminal or a page just close", () => {
        for (const meta of [{ "cmd:initscript": "cd '/w' && claude" }, { "cmd:initscript": "" }, { view: "term" }, { view: "web", url: "https://x" }, undefined])
            expect(shelvable(meta as MetaType)).toBeUndefined();
    });
});

// ⌥ changes the character a key types on a Mac (⌥D is ∂), so a ⌥ shortcut matched by its
// character never fires from a real keyboard; it names the physical key, c{KeyD}.
test("every ⌥ shortcut names its physical key", () => {
    const option = WINTOS_KEYS.map(([k]) => k).filter((k) => k.includes("Option"));
    expect(option.length).toBeGreaterThan(10);
    expect(option.filter((k) => !/:c\{(Key[A-Z]|Digit\d)\}$|:(Arrow\w+|\d)$/.test(k))).toEqual([]);
});
