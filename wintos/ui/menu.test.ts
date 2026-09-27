import { describe, expect, test } from "vitest";
import { blockDefFor } from "./menu";

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
