import { ContextMenuModel } from "@/app/store/contextmenu";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getWaveObjectAtom, makeORef } from "@/app/store/wos";
import { atoms, getApi } from "@/store/global";
import { fireAndForget } from "@/util/util";
import { atom, useAtomValue } from "jotai";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Row } from "../daemon/ranking/rank";
import { T } from "./tokens";
import { useNow } from "./useNow";
import { setProjectTitle, useWintos } from "./useWintos";
import { rowView, RowView, sidebarModel } from "./view";

const BAND_STYLE = {
    needs: { label: "Needs you", color: T.apricot },
    running: { label: "Running", color: T.moss },
    quiet: { label: "Quiet", color: T.muted },
} as const;

function useTabNames(tabIds: string[]): Record<string, string | undefined> {
    const namesAtom = useMemo(
        () => atom((get) => Object.fromEntries(tabIds.map((id) => [id, get(getWaveObjectAtom<Tab>(makeORef("tab", id)))?.name]))),
        [tabIds.join(",")]
    );
    return useAtomValue(namesAtom);
}

export const WintOSSidebar = memo(({ workspace }: { workspace: Workspace }) => {
    const tabIds = workspace?.tabids ?? [];
    const activeTabId = useAtomValue(atoms.staticTabId);
    const names = useTabNames(tabIds);
    const { state, offline } = useWintos();
    const now = useNow();
    const [showAll, setShowAll] = useState(false);
    const [cursor, setCursor] = useState(0);
    const [renaming, setRenaming] = useState<string | null>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const model = state ? sidebarModel(tabIds, state) : null;
    const project = (tabId: string) => state?.projects.find((p) => p.id === tabId);
    const quiet = model ? (showAll ? [...model.quiet, ...model.quietMore] : model.quiet) : [];
    const order = model ? [...model.needs, ...model.running, ...quiet] : [];

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
                { type: "separator" },
                { label: "Close tab", click: () => fireAndForget(() => getApi().closeTab(workspace.oid, tabId, true)) },
            ],
            e
        );
    };
    const onKey = (e: React.KeyboardEvent) => {
        if (renaming || !order.length) return;
        if (e.key === "j") setCursor((c) => Math.min(c + 1, order.length - 1));
        else if (e.key === "k") setCursor((c) => Math.max(c - 1, 0));
        else if (e.key === "Enter") open(order[Math.min(cursor, order.length - 1)].tabId);
        else return;
        e.preventDefault();
    };

    const renderRow = (row: Row) => {
        const v = rowView(row, project(row.tabId), names[row.tabId], now);
        const props = {
            key: row.tabId,
            tabId: row.tabId,
            v,
            active: row.tabId === activeTabId,
            cursor: order[cursor]?.tabId === row.tabId,
            renaming: renaming === row.tabId,
            onOpen: () => open(row.tabId),
            onMenu: (e: React.MouseEvent) => menu(e, row.tabId),
            onRename: (title: string | null) => {
                setRenaming(null);
                listRef.current?.focus();
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
                        {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }).toLowerCase()}
                    </span>
                </div>
                <span style={{ fontFamily: T.mono, fontSize: 10, color: T.muted }}>{tabIds.length} {tabIds.length === 1 ? "project" : "projects"}</span>
            </div>
            <div
                ref={listRef}
                tabIndex={0}
                onKeyDown={onKey}
                style={{ flexGrow: 1, overflowY: "auto", padding: "4px 12px 12px", display: "flex", flexDirection: "column", gap: 18, outline: "none" }}
            >
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
                                    {showAll ? "Show fewer" : `Show all ${model.quiet.length + model.quietMore.length}`}
                                    {model.quietStale.length > 0 && (
                                        <span style={{ color: T.faint }}> · {model.quietStale.length} untouched over two weeks are only in ⌘K</span>
                                    )}
                                </button>
                            )}
                        </Band>
                    </>
                )}
            </div>
            <div style={{ flexShrink: 0, height: 34, padding: "0 14px", display: "flex", alignItems: "center", gap: 16, borderTop: `1px solid ${T.hairline}`, fontSize: 11, color: T.faint }}>
                <Key k="j k" label="move" />
                <Key k="⏎" label="open" />
                <Key k="⌃⇥" label="waiting" />
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
                border: `1px solid ${p.active || p.cursor ? T.borderActive : T.border}`,
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
                border: `1px solid ${p.cursor ? T.borderActive : "transparent"}`,
            }}
        >
            <Title v={v} renaming={p.renaming} onRename={p.onRename} style={{ fontSize: 13, color: p.active ? T.emphasis : T.quietTitle, fontFamily: T.ui }} />
            <span style={{ fontSize: 10.5, color: v.tone === "brick" ? T.brick : T.faint, flexShrink: 0 }}>{v.tone === "brick" ? "note unreadable" : v.reason}</span>
        </div>
    );
}

function Key({ k, label }: { k: string; label: string }) {
    return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
            <span style={{ fontFamily: T.mono, fontSize: 9.5, color: T.keycapText, background: T.keycapBg, border: `1px solid ${T.keycapBorder}`, borderBottomWidth: 2, borderRadius: 5, padding: "2px 6px" }}>{k}</span>
            {label}
        </span>
    );
}
