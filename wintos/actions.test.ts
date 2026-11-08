import { readFileSync } from "fs";
import { join } from "path";
import { expect, test } from "vitest";
import { ACTIONS, KEY_BINDINGS } from "./actions";

const src = (f: string) => readFileSync(join(__dirname, f), "utf8");

test("every action is one runAction handles", () => {
    const menu = src("ui/menu.ts");
    const unhandled = ACTIONS.filter((a) => !menu.includes(`action === "${a.id}"`) && !(a.id.startsWith("session-") && menu.includes('action.startsWith("session-")')));
    expect(unhandled.map((a) => a.id)).toEqual([]);
});

test("no key is bound twice", () => {
    const chords = KEY_BINDINGS.map(([c]) => c);
    expect(chords.filter((c, i) => chords.indexOf(c) !== i)).toEqual([]);
});

test("the keymap card lists every action's key", () => {
    const card = src("ui/Keymap.tsx");
    const missing = ACTIONS.filter((a) => !card.includes(a.id.startsWith("session-") ? "⌥⌘1–9" : a.key));
    expect(missing.map((a) => `${a.id} ${a.key}`)).toEqual([]);
});

test("no bracket or punctuation key: they need ⌥ on a German or Swedish keyboard", () =>
    expect(KEY_BINDINGS.filter(([c]) => /[[\]{};',./\\`=-]$/.test(c.replace(/\{[A-Za-z0-9]+\}$/, "")))).toEqual([]));
