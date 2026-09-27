import type { WintosState } from "./view";

// The generic plugin UI contract: a plugin's JSON may carry `panel`, which WintOS renders
// as a sidebar card and a view with each count's url open in a browser pane.
export type PanelCount = { label: string; count: number | null; note?: string | null; url?: string };
export type Panel = { name: string; title: string; subtitle?: string; counts: PanelCount[]; at: number; error?: string };

export function pluginPanels(state: WintosState): Panel[] {
    const out: Panel[] = [];
    for (const [name, r] of Object.entries(state.plugins ?? {})) {
        const p = (r.data as { panel?: Record<string, unknown> } | undefined)?.panel;
        if (!p || p.hidden || typeof p.title !== "string" || !Array.isArray(p.counts)) continue;
        out.push({ name, title: p.title, subtitle: typeof p.subtitle === "string" ? p.subtitle : undefined, counts: p.counts as PanelCount[], at: r.at, ...(r.ok ? {} : { error: r.error }) });
    }
    return out;
}

export function cardValue(counts: Pick<PanelCount, "label" | "count">[]): { value: string; note: string } {
    return { value: counts.map((c) => (c.count == null ? "?" : String(c.count))).join("·"), note: counts.map((c) => c.label).join(" · ") };
}
