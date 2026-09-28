// The tabs of the browser pane beside the PR queue: one per opened PR or link.
export type PrTabs = { urls: string[]; active: number };
export const NO_TABS: PrTabs = { urls: [], active: 0 };

export function openTab(t: PrTabs, url: string): PrTabs {
    const i = t.urls.indexOf(url);
    return i >= 0 ? { ...t, active: i } : { urls: [...t.urls, url], active: t.urls.length };
}

export function closeTab(t: PrTabs, index: number): PrTabs {
    const urls = t.urls.filter((_, i) => i !== index);
    const active = index < t.active || (index === t.active && index === urls.length) ? t.active - 1 : t.active;
    return { urls, active: Math.max(0, Math.min(active, urls.length - 1)) };
}

export function stepTab(t: PrTabs, delta: 1 | -1): PrTabs {
    const n = t.urls.length;
    return n ? { ...t, active: (t.active + delta + n) % n } : t;
}
