import type { WintosState } from "./view";

// The generic plugin UI contract: a plugin's JSON may carry `panel`, which WintOS renders
// as a sidebar card and a view with each count's url open in a browser pane.
export type PanelCount = { label: string; count: number | null; note?: string | null; url?: string };
export type Panel = { name: string; title: string; subtitle?: string; counts: PanelCount[]; at: number; error?: string };

const str = (v: unknown): v is string => typeof v === "string";

// Plugin output is untrusted: a bad entry is dropped rather than allowed to break the render,
// and only http(s) urls reach a <webview>.
function validCount(c: unknown): PanelCount | null {
    if (!c || typeof c !== "object") return null;
    const o = c as Record<string, unknown>;
    if (!str(o.label) || !(o.count === null || typeof o.count === "number")) return null;
    const out: PanelCount = { label: o.label, count: o.count as number | null };
    if (str(o.note)) out.note = o.note;
    if (str(o.url) && /^https?:\/\//i.test(o.url)) out.url = o.url;
    return out;
}

export function pluginPanels(state: WintosState): Panel[] {
    const out: Panel[] = [];
    for (const [name, r] of Object.entries(state.plugins ?? {})) {
        const p = (r.data as { panel?: Record<string, unknown> } | undefined)?.panel;
        if (!p || p.hidden || !str(p.title) || !Array.isArray(p.counts)) continue;
        let counts = p.counts.map(validCount).filter((c): c is PanelCount => !!c);
        // Old numbers after a failed run would read as current; a false 0 is worse than none.
        if (!r.ok) counts = counts.map((c) => ({ label: c.label, count: null, note: `stale: last run failed (${r.error ?? "unknown"})`, ...(c.url ? { url: c.url } : {}) }));
        out.push({ name, title: p.title, subtitle: str(p.subtitle) ? p.subtitle : undefined, counts, at: r.at, ...(r.ok ? {} : { error: r.error }) });
    }
    return out;
}

export type CardStat = { value: string; label: string };
export function cardValue(counts: Pick<PanelCount, "label" | "count">[]): CardStat[] {
    return counts.map((c) => ({ value: c.count == null ? "?" : String(c.count), label: c.label }));
}

// Plugins still on their first run: shown as loading cards instead of not at all. gh-prs has
// its own card. The title comes from the last run the UI saw (kept by the caller).
export function loadingPanels(state: WintosState, lastTitles: Record<string, string>): { name: string; title: string }[] {
    return (state.pluginNames ?? []).filter((n) => n !== "gh-prs" && !state.plugins?.[n]).map((name) => ({ name, title: lastTitles[name] ?? name }));
}
