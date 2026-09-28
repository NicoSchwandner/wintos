import { ContextMenuModel } from "@/app/store/contextmenu";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getWaveObjectAtom, makeORef } from "@/app/store/wos";
import { atoms, getApi } from "@/store/global";
import { fireAndForget } from "@/util/util";
import { atom, useAtom, useAtomValue } from "jotai";
import { memo, useEffect, useMemo, useState } from "react";
import type { Row } from "../daemon/ranking/rank";
import { Key } from "./Key";
import { T } from "./tokens";
import { useNow } from "./useNow";
import { editMine, focusArea, setLatestSessions } from "./focus";
import { setSwitchOrder, switchTargetAtom } from "./switcher";
import { registerWintosMenu } from "./menu";
import { renamingAtom } from "./notes/state";
import { liveSessions } from "./sessions";
import { setProjectTitle, useWintos } from "./useWintos";
import { ghPrs, isPlaceholderTab, prsByTab, rowView, RowView, sidebarModel } from "./view";
import { queueModel } from "./prs";
import { openPanel, toggleView } from "./menu";
import { cardValue, loadingPanels, pluginPanels } from "./panels";

const BAND_STYLE = {
    needs: { label: "Needs you", color: T.apricot },
    running: { label: "Running", color: T.moss },
    quiet: { label: "Quiet", color: T.muted },
} as const;

function useTabs(tabIds: string[]): Record<string, Tab | undefined> {
    const tabsAtom = useMemo(
        () => atom((get) => Object.fromEntries(tabIds.map((id) => [id, get(getWaveObjectAtom<Tab>(makeORef("tab", id)))]))),
        [tabIds.join(",")]
    );
    return useAtomValue(tabsAtom);
}

export const WintOSSidebar = memo(({ workspace }: { workspace: Workspace }) => {
    const allTabIds = workspace?.tabids ?? [];
    const activeTabId = useAtomValue(atoms.staticTabId);
    const tabs = useTabs(allTabIds);
    const tabIds = allTabIds.filter((id) => !isPlaceholderTab(tabs[id]));
    const names = Object.fromEntries(tabIds.map((id) => [id, tabs[id]?.name]));
    const { state: raw, offline } = useWintos();
    const state = raw && { ...raw, sessions: liveSessions(raw.sessions, Object.fromEntries(tabIds.map((id) => [id, tabs[id]?.blockids]))) };
    const now = useNow();
    const [showAll, setShowAll] = useState(false);
    const switchTarget = useAtomValue(switchTargetAtom);
    const [renaming, setRenaming] = useAtom(renamingAtom);

    const model = state ? sidebarModel(tabIds, state) : null;
    const prsTab = state ? prsByTab(tabIds, state) : {};
    const gh = state ? ghPrs(state) : undefined;
    const queue = gh ? queueModel(gh.prs, gh.me, now) : null;
    const panels = state ? pluginPanels(state) : [];
    const loading = state ? loadingPanels(state, lastPanelTitles(panels)) : [];
    const running = new Set(state?.pluginsRunning ?? []);
    const project = (tabId: string) => state?.projects.find((p) => p.id === tabId);
    // The open tab is always visible even when it is stale; walking with ⌘J/⌘K or renaming
    // (the row must exist to hold the input) shows them all.
    const expanded = showAll || switchTarget != null || renaming != null;
    const activeStale = model?.quietStale.filter((r) => r.tabId === activeTabId && !expanded) ?? [];
    const quiet = model ? (expanded ? [...model.quiet, ...model.quietMore, ...model.quietStale] : [...model.quiet, ...activeStale]) : [];
    const switchOrder = model ? [...model.needs, ...model.running, ...model.quiet, ...model.quietMore, ...model.quietStale].map((r) => r.tabId) : [];

    useEffect(registerWintosMenu, []);

    useEffect(() => void setSwitchOrder(switchOrder), [switchOrder.join(",")]);
    useEffect(() => void document.querySelector(`[data-wintos=sidebar-list] [data-tabid="${switchTarget}"]`)?.scrollIntoView({ block: "nearest" }), [switchTarget]);

    useEffect(() => {
        if (state) setLatestSessions(state.sessions, tabIds, model?.needs.map((r) => r.tabId) ?? []);
    }, [state, tabIds.join(",")]);

    // The project title is the source of truth; the tab name follows it.
    useEffect(() => {
        for (const p of state?.projects ?? []) {
            if (p.id && p.title && tabIds.includes(p.id) && names[p.id] !== p.title)
                fireAndForget(() => RpcApi.UpdateTabNameCommand(TabRpcClient, p.id!, p.title!));
        }
    }, [state, names]);

    const open = (tabId: string) => getApi().setActiveTab(tabId);
    const menu = (e: React.MouseEvent, tabId: string) => {
        e.preventDefault();
        ContextMenuModel.getInstance().showContextMenu(
            [
                { label: "Open project", click: () => open(tabId) },
                { label: "Rename…", click: () => setRenaming(tabId) },
                {
                    label: "Edit mine.md",
                    enabled: tabId === activeTabId,
                    click: () => editMine(true),
                },
                { type: "separator" },
                { label: "Close tab", click: () => fireAndForget(() => getApi().closeTab(workspace.oid, tabId, true)) },
            ],
            e
        );
    };
    const renderRow = (row: Row) => {
        const v = rowView(row, project(row.tabId), names[row.tabId], now, prsTab[row.tabId]);
        const props = {
            key: row.tabId,
            tabId: row.tabId,
            v,
            active: row.tabId === activeTabId,
            cursor: switchTarget === row.tabId,
            renaming: renaming === row.tabId,
            onOpen: () => open(row.tabId),
            onMenu: (e: React.MouseEvent) => menu(e, row.tabId),
            onRename: (title: string | null) => {
                setRenaming(null);
                focusArea("terminal");
                if (title?.trim()) fireAndForget(() => setProjectTitle(row.tabId, title.trim(), true));
            },
        };
        return row.band === "quiet" ? <QuietRow {...props} /> : <CardRow {...props} />;
    };

    return (
        <div style={{ height: "100%", display: "flex", flexDirection: "column", background: T.sidebar, borderRight: `1px solid ${T.border}`, fontFamily: T.ui, color: T.text }}>
            <div style={{ padding: "36px 16px 13px", display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    <span style={{ fontFamily: T.display, fontSize: 21, lineHeight: 1 }}>WintOS</span>
                    <span style={{ fontFamily: T.mono, fontSize: 10, color: T.muted }}>
                        <DateTime />
                    </span>
                </div>
                <span style={{ fontFamily: T.mono, fontSize: 10, color: T.muted }}>{tabIds.length} {tabIds.length === 1 ? "project" : "projects"}</span>
            </div>
            <div
                data-wintos="sidebar-list"
                style={{ flexGrow: 1, overflowY: "auto", padding: "4px 12px 12px", display: "flex", flexDirection: "column", gap: 18 }}
            >
                {state && (
                    <div style={{ display: "flex", gap: 8 }}>
                        {queue ? (
                            <SummaryCard label="PRs" value={String(queue.yours)} note={running.has("gh-prs") ? "updating…" : queue.pastSla ? `${queue.pastSla} past SLA` : "nothing late"} noteColor={queue.pastSla ? T.brick : T.muted} onClick={() => toggleView("prs")} />
                        ) : (
                            <SummaryCard label="PRs" value="…" note="loading from GitHub" noteColor={T.faint} onClick={() => toggleView("prs")} />
                        )}
                        {panels.map((p) => {
                            const c = cardValue(p.counts);
                            return <SummaryCard key={p.name} label={p.title} value={c.value} note={running.has(p.name) ? "updating…" : c.note} noteColor={p.error || p.counts.some((x) => x.count == null) ? T.brick : T.muted} onClick={() => openPanel(p.name)} />;
                        })}
                        {loading.map((p) => <SummaryCard key={p.name} label={p.title} value="…" note="loading" noteColor={T.faint} onClick={() => openPanel(p.name)} />)}
                    </div>
                )}
                {offline || !model ? (
                    <div style={{ fontFamily: T.mono, fontSize: 11, color: offline ? T.brick : T.muted, padding: "0 4px" }}>
                        {offline ? "daemon offline: bands hidden until wintosd is back" : "connecting to wintosd…"}
                    </div>
                ) : (
                    <>
                        <Band kind="needs" count={model.needs.length}>{model.needs.map(renderRow)}</Band>
                        <Band kind="running" count={model.running.length}>{model.running.map(renderRow)}</Band>
                        <Band kind="quiet" count={model.quiet.length + model.quietMore.length} shown={quiet.length}>
                            {quiet.map(renderRow)}
                            {(model.quietMore.length > 0 || model.quietStale.length > 0) && (
                                <button
                                    type="button"
                                    onClick={() => setShowAll((s) => !s)}
                                    style={{ margin: "4px 13px 0", padding: "7px 0", background: "transparent", border: "none", borderTop: `1px solid #201C1A`, textAlign: "left", fontFamily: T.ui, fontSize: 11.5, color: T.muted, cursor: "pointer" }}
                                >
                                    {showAll ? "Show fewer" : `Show all ${model.quiet.length + model.quietMore.length + model.quietStale.length}`}
                                    {!showAll && model.quietStale.length > 0 && (
                                        <span style={{ color: T.faint }}> · includes {model.quietStale.length} untouched over two weeks</span>
                                    )}
                                </button>
                            )}
                        </Band>
                    </>
                )}
            </div>
            <div style={{ flexShrink: 0, height: 34, padding: "0 14px", display: "flex", alignItems: "center", gap: 16, borderTop: `1px solid ${T.hairline}`, fontSize: 11, color: T.faint }}>
                <Key k="⌘J ⌘K" label="switch" />
                <Key k="⌃⇥" label="waiting" />
                <Key k="⌘R" label="rename" />
            </div>
        </div>
    );
});
WintOSSidebar.displayName = "WintOSSidebar";

function Band({ kind, count, shown, children }: { kind: keyof typeof BAND_STYLE; count: number; shown?: number; children: React.ReactNode }) {
    if (!count) return null;
    const s = BAND_STYLE[kind];
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: kind === "quiet" ? 3 : 7 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 4px" }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: kind === "quiet" ? "#2E2825" : s.color }} />
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: s.color }}>{s.label}</span>
                <span style={{ flexGrow: 1, height: 1, background: kind === "quiet" ? "#201C1A" : T.hairline }} />
                <span style={{ fontFamily: T.mono, fontSize: 10, color: T.muted }}>{shown !== undefined && shown < count ? `${shown} of ${count}` : count}</span>
            </div>
            {children}
        </div>
    );
}

type RowProps = {
    tabId: string;
    v: RowView;
    active: boolean;
    cursor: boolean;
    renaming: boolean;
    onOpen: () => void;
    onMenu: (e: React.MouseEvent) => void;
    onRename: (title: string | null) => void;
};

function Title({ v, renaming, onRename, style }: Pick<RowProps, "v" | "renaming" | "onRename"> & { style: React.CSSProperties }) {
    if (!renaming) return <span style={style}>{v.title}</span>;
    return (
        <input
            autoFocus
            defaultValue={v.title}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") onRename(e.currentTarget.value);
                if (e.key === "Escape") onRename(null);
            }}
            onBlur={(e) => onRename(e.currentTarget.value)}
            style={{ ...style, background: T.ground, border: `1px solid ${T.borderActive}`, borderRadius: 5, padding: "1px 4px", outline: "none", width: "100%" }}
        />
    );
}

function CardRow(p: RowProps) {
    const { v } = p;
    const tone = { apricot: T.apricot, brick: T.brick, secondary: T.secondary }[v.tone ?? "secondary"];
    return (
        <div
            data-tabid={p.tabId}
            data-band="card"
            onClick={p.onOpen}
            onContextMenu={p.onMenu}
            style={{
                display: "flex",
                flexDirection: "column",
                gap: 7,
                padding: "12px 13px",
                cursor: "pointer",
                borderRadius: 10,
                background: p.active ? T.cardActive : T.card,
                border: `1px solid ${p.cursor ? T.apricot : p.active ? T.borderActive : T.border}`,
            }}
        >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <Title v={v} renaming={p.renaming} onRename={p.onRename} style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.005em", color: p.active ? T.emphasis : T.title, fontFamily: T.ui }} />
                <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    {p.active && <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: "0.06em", color: T.muted }}>open</span>}
                    <span style={{ fontFamily: T.mono, fontSize: 10, color: T.muted }}>{v.age}</span>
                </span>
            </div>
            {v.next && <div style={{ fontSize: 12.5, lineHeight: 1.4, color: tone, textWrap: "pretty" } as React.CSSProperties}>{v.next}</div>}
            {v.meta && <div style={{ fontFamily: T.mono, fontSize: 9.5, color: T.muted }}>{v.meta}</div>}
        </div>
    );
}

function QuietRow(p: RowProps) {
    const { v } = p;
    return (
        <div
            data-tabid={p.tabId}
            data-band="quiet"
            onClick={p.onOpen}
            onContextMenu={p.onMenu}
            style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                padding: "8px 13px",
                cursor: "pointer",
                borderRadius: 8,
                background: p.active ? T.cardActive : "transparent",
                border: `1px solid ${p.cursor ? T.apricot : "transparent"}`,
            }}
        >
            <Title v={v} renaming={p.renaming} onRename={p.onRename} style={{ fontSize: 13, color: p.active ? T.emphasis : T.quietTitle, fontFamily: T.ui }} />
            <span style={{ fontSize: 10.5, color: v.tone === "brick" ? T.brick : T.faint, flexShrink: 0 }}>{v.tone === "brick" ? "note unreadable" : v.reason}</span>
        </div>
    );
}


// Its own component so the per-second tick re-renders only this line, not the sidebar.
function DateTime() {
    const d = new Date(useNow(1_000));
    return (
        <>
            {d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }).toLowerCase()} · {d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}
        </>
    );
}

// A panel's title from its last run, so after a restart its loading card says "On call", not
// the plugin's file name. Per-viewer convenience, so browser storage.
const TITLES_KEY = "wintos:panel-titles";
function lastPanelTitles(panels: { name: string; title: string }[]): Record<string, string> {
    let saved: Record<string, string> = {};
    try {
        saved = JSON.parse(localStorage.getItem(TITLES_KEY) ?? "{}");
        const now = Object.fromEntries(panels.map((p) => [p.name, p.title]));
        if (panels.some((p) => saved[p.name] !== p.title)) localStorage.setItem(TITLES_KEY, JSON.stringify({ ...saved, ...now }));
        return { ...saved, ...now };
    } catch {
        return saved;
    }
}

function SummaryCard({ label, value, note, noteColor, onClick }: { label: string; value: string; note: string; noteColor: string; onClick: () => void }) {
    return (
        <div onClick={onClick} style={{ flexGrow: 1, flexBasis: 0, padding: "11px 13px", background: "#1E1A18", border: "1px solid #2E2825", borderRadius: 10, display: "flex", flexDirection: "column", gap: 5, cursor: "pointer" }}>
            <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: T.secondary }}>{label}</span>
                <span style={{ fontFamily: T.display, fontSize: 22, lineHeight: 1, color: T.text }}>{value}</span>
            </span>
            <span style={{ fontFamily: T.mono, fontSize: 9.5, color: noteColor }}>{note}</span>
        </div>
    );
}
