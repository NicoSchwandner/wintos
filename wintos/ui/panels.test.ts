import { describe, expect, test } from "vitest";
import { cardValue, pluginPanels } from "./panels";

const state = (plugins: Record<string, unknown>) => ({ now: 0, sessions: [], projects: [], plugins: plugins as never });

describe("pluginPanels", () => {
    test("plugins that publish a visible panel become panels, named after the plugin", () => {
        const p = pluginPanels(state({
            "status-check": { ok: true, at: 1, data: { panel: { title: "On call", subtitle: "team-core", hidden: false, counts: [{ label: "errors", count: 21, url: "https://e" }] } } },
            "gh-prs": { ok: true, at: 1, data: { me: "x", prs: [] } },
            hidden: { ok: true, at: 1, data: { panel: { title: "Off", hidden: true, counts: [] } } },
        }));
        expect(p.map((x) => [x.name, x.title, x.counts.length])).toEqual([["status-check", "On call", 1]]);
    });

    test("a failed run keeps its last panel and carries the error", () => {
        const p = pluginPanels(state({ o: { ok: false, at: 1, error: "boom", data: { panel: { title: "On call", counts: [] } } } }));
        expect(p[0]).toMatchObject({ name: "o", error: "boom" });
    });

    test("malformed panels are ignored, not rendered half", () =>
        expect(pluginPanels(state({ o: { ok: true, at: 1, data: { panel: { counts: "nope" } } } }))).toEqual([]));
});

describe("cardValue", () => {
    test("counts joined with a dot, unknown ones as ?", () =>
        expect(cardValue([{ label: "errors", count: 12 }, { label: "errands", count: null }])).toEqual({ value: "12·?", note: "errors · errands" }));
});
