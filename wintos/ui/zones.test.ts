import { describe, expect, test, vi } from "vitest";
import { closeAction, escapeAction, setZoneKeys, zoneKey, zoneOf } from "./zones";

// A focused element inside a zone container, without a DOM.
function inZone(zone: string | null, tagName = "DIV") {
    const container = { dataset: { zone } };
    return { container, el: { tagName, closest: (sel: string) => (sel === "[data-zone]" && zone ? container : null) } as unknown as Element };
}
const key = (k: string, mods: Partial<WaveKeyboardEvent> = {}) => ({ key: k, code: "", type: "keydown", cmd: false, shift: false, control: false, option: false, alt: false, meta: false, ...mods }) as WaveKeyboardEvent;

describe("zoneOf", () => {
    test("the nearest data-zone decides, and outside any zone is a pane", () => {
        expect(zoneOf(inZone("list").el)).toBe("list");
        expect(zoneOf(inZone("overlay").el)).toBe("overlay");
        expect(zoneOf(inZone(null).el)).toBe("pane");
        expect(zoneOf(null)).toBe("pane");
    });
});

describe("zoneKey", () => {
    test("a zone's table runs its key, and only for that zone", () => {
        const list = inZone("list");
        const down = vi.fn();
        setZoneKeys(list.container as unknown as Element, { j: down });
        expect(zoneKey(key("j"), list.el)).toBe("handled");
        expect(down).toHaveBeenCalledOnce();
        expect(zoneKey(key("j"), inZone("list").el)).toBe(false);
    });

    test("a letter with ⌘ is not the plain letter: ⌘J stays the project switch", () => {
        const list = inZone("list");
        const down = vi.fn();
        setZoneKeys(list.container as unknown as Element, { j: down });
        expect(zoneKey(key("j", { cmd: true, meta: true }), list.el)).toBe(false);
        expect(down).not.toHaveBeenCalled();
    });

    test("typing in a text field never fires a letter; named keys and chords still do", () => {
        const field = inZone("overlay", "INPUT");
        const letter = vi.fn();
        const enter = vi.fn();
        const next = vi.fn();
        setZoneKeys(field.container as unknown as Element, { z: letter, Enter: enter, "Ctrl:n": next });
        expect(zoneKey(key("z"), field.el)).toBe("typing");
        expect(zoneKey(key("Enter"), field.el)).toBe("handled");
        expect(zoneKey(key("n", { control: true }), field.el)).toBe("handled");
        expect(letter).not.toHaveBeenCalled();
    });

    test("a shifted character in a text field is typed too, even when a table names it", () => {
        const field = inZone("overlay", "INPUT");
        const help = vi.fn();
        setZoneKeys(field.container as unknown as Element, { "Shift:?": help });
        expect(zoneKey(key("?", { shift: true }), field.el)).toBe("typing");
        expect(help).not.toHaveBeenCalled();
    });

    test("any other key in a text field stays with the field: no project switch, no pane behind it", () => {
        const field = inZone("overlay", "TEXTAREA");
        setZoneKeys(field.container as unknown as Element, {});
        expect(zoneKey(key("j", { cmd: true, meta: true }), field.el)).toBe("typing");
        expect(zoneKey(key("w", { cmd: true, meta: true }), field.el)).toBe("typing");
        expect(zoneKey(key("End", { cmd: true, meta: true }), field.el)).toBe("typing");
    });

    test("Esc in a text field still goes on, so an overlay's Esc closes it", () => {
        const field = inZone("overlay", "INPUT");
        setZoneKeys(field.container as unknown as Element, {});
        expect(zoneKey(key("Escape"), field.el)).toBe(false);
    });

    test("a handler returning false lets the key go on", () => {
        const list = inZone("list");
        setZoneKeys(list.container as unknown as Element, { Enter: () => false });
        expect(zoneKey(key("Enter"), list.el)).toBe(false);
    });
});

describe("escapeAction", () => {
    const base = { overlay: false, zone: "pane" as const, inInbox: false, onPage: false };
    test("an overlay closes first", () => expect(escapeAction({ ...base, overlay: true, zone: "list" })).toBe("overlay"));
    test("a list goes back to the panes", () => expect(escapeAction({ ...base, zone: "list" })).toBe("panes"));
    test("a page in the Inbox returns to its list", () => expect(escapeAction({ ...base, inInbox: true, onPage: true })).toBe("list"));
    test("in a pane Esc stays the pane's: a terminal gets it and Claude is interrupted", () => {
        expect(escapeAction(base)).toBe("wave");
        expect(escapeAction({ ...base, onPage: true })).toBe("wave");
    });
});

describe("closeAction", () => {
    const base = { overlay: false, notesShown: false, zone: "pane" as const, paneFocused: true, paneHidden: false };
    test("an overlay closes first", () => expect(closeAction({ ...base, overlay: true })).toBe("overlay"));
    test("the full notes view goes back to the terminals", () => expect(closeAction({ ...base, notesShown: true })).toBe("view"));
    test("the focused, visible pane closes", () => expect(closeAction(base)).toBe("pane"));
    test("with a list focused nothing closes", () => expect(closeAction({ ...base, zone: "list" })).toBe("nothing"));
    test("never a hidden pane, and never the project when no pane is left", () => {
        expect(closeAction({ ...base, paneHidden: true })).toBe("nothing");
        expect(closeAction({ ...base, paneFocused: false })).toBe("nothing");
    });
});
