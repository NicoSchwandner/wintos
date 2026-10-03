import { ContextMenuModel } from "@/app/store/contextmenu";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getWaveObjectAtom, makeORef } from "@/app/store/wos";
import { atoms, getApi } from "@/store/global";
import { fireAndForget } from "@/util/util";
import { atom, useAtom, useAtomValue } from "jotai";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Row } from "../daemon/ranking/rank";
import { Key } from "./Key";
import { Rich } from "./notes/ProjectNotes";
import { MeetingCard, MeetingEdge } from "./MeetingCard";
import { TodayCard } from "./TodayCard";
import { GameChip, GameLine } from "./GameIndicator";
import { meetingsFrom } from "./meetings";
import { ACTIVE, T } from "./tokens";
import { useNow } from "./useNow";
import { editMine, enterProject, focusArea, setLatestSessions } from "./focus";
import { setSwitchOrder, switchTargetAtom } from "./switcher";
import { closeProjectTab, registerWintosMenu } from "./menu";
import { isPage, mainViewAtom, renamingAtom } from "./notes/state";
import { liveSessions } from "./sessions";
import { instance, setProjectSnoozed, setProjectTitle, useWintos } from "./useWintos";
import { ghPrs, inboxKind, isInboxTab, prsByTab, type InboxList, projectTabIds, rowView, RowView, sidebarModel, withSnoozes } from "./view";
import { queueModel } from "./prs";
import { goToInbox } from "./inbox";
import { useZoneKeys } from "./zones";
import { cardValue, loadingPanels, pluginPanels, type CardStat } from "./panels";

const BAND_STYLE = {
    needs: { label: "Needs you", color: T.apricot },
    running: { label: "Running", color: T.moss },
    quiet: { label: "Quiet", color: T.muted },
    snoozed: { label: "Snoozed", color: T.faint },
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
    const tabIds = projectTabIds(allTabIds, tabs);
    // In the PRs or On call tab its card is marked, as the current project's row is.
    // What fills the window right now is marked, and only that: the Today page covers the tab
    // under it, so neither that project's row nor an Inbox card is marked while it shows.
    const shows = (list: InboxList) => !isPage(mainView) && inboxKind(tabs[activeTabId]) === list;
    const names = Object.fromEntries(tabIds.map((id) => [id, tabs[id]?.name]));
    const { state: raw, offline } = useWintos();
    const state = raw && { ...raw, sessions: liveSessions(raw.sessions, Object.fromEntries(tabIds.map((id) => [id, tabs[id]?.blockids]))) };
    const now = useNow();
    const fullScreen = useAtomValue(atoms.isFullScreen);
    const mainView = useAtomValue(mainViewAtom);
    const [showAll, setShowAll] = useStoredFlag("wintos:show-all-quiet");
    const [showSnoozed, setShowSnoozed] = useStoredFlag("wintos:show-snoozed");
    const switchTarget = useAtomValue(switchTargetAtom);
    const [renaming, setRenaming] = useAtom(renamingAtom);

    const model = state ? withSnoozes(sidebarModel(tabIds, state), state.projectSnoozes) : null;
    const prsTab = state ? prsByTab(tabIds, state) : {};
    const gh = state ? ghPrs(state) : undefined;
    const queue = gh ? queueModel(gh.prs, gh.me, now, state?.snoozes) : null;
    const panels = state ? pluginPanels(state) : [];
    const loading = state ? loadingPanels(state, lastPanelTitles(panels)) : [];
    const running = new Set(state?.pluginsRunning ?? []);
    const meetings = useMemo(() => meetingsFrom(state?.plugins), [state?.plugins]);
    const project = (tabId: string) => state?.projects.find((p) => p.id === tabId);
    // The open tab is always visible even when it is stale; walking with ⌘J/⌘K or renaming
    // (the row must exist to hold the input) shows them all.
    const expanded = showAll || switchTarget != null || renaming != null;
    const activeStale = model?.quietStale.filter((r) => r.tabId === activeTabId && !expanded) ?? [];
    const quiet = model ? (expanded ? [...model.quiet, ...model.quietMore, ...model.quietStale] : [...model.quiet, ...activeStale]) : [];
    // Snoozed projects join the walk while their group is shown; landing on one wakes it.
    const switchOrder = model ? [...model.needs, ...model.running, ...model.quiet, ...model.quietMore, ...model.quietStale, ...(showSnoozed ? model.snoozed : [])].map((r) => r.tabId) : [];
    // Snoozed rows show on their own toggle or while renaming one; the open one always, to find it again.
    const isSnoozedHere = !!model?.snoozed.some((r) => r.tabId === activeTabId);
    const snoozedShown = model ? (showSnoozed || renaming != null ? model.snoozed : model.snoozed.filter((r) => r.tabId === activeTabId)) : [];
    // A snoozed project that needs you is back for good, not only while it needs you.
    useEffect(() => model?.wake.forEach((id) => void setProjectSnoozed(id, false)), [model?.wake.join(",")]);

    useEffect(registerWintosMenu, []);

    useEffect(() => void setSwitchOrder(switchOrder), [switchOrder.join(",")]);
    useEffect(() => void document.querySelector(`[data-wintos=sidebar-list] [data-tabid="${switchTarget}"]`)?.scrollIntoView({ block: "nearest" }), [switchTarget]);

    useEffect(() => {
        if (state) setLatestSessions(state.sessions, tabIds, model?.needs.map((r) => r.tabId) ?? [], model?.snoozed.map((r) => r.tabId) ?? []);
    }, [state, tabIds.join(",")]);

    // The project title is the source of truth; the tab name follows it.
    useEffect(() => {
        for (const p of state?.projects ?? []) {
            if (p.id && p.title && tabIds.includes(p.id) && names[p.id] !== p.title)
                fireAndForget(() => RpcApi.UpdateTabNameCommand(TabRpcClient, p.id!, p.title!));
        }
    }, [state, names]);

    const open = (tabId: string) => (tabId === activeTabId ? focusArea("terminal") : enterProject(tabId));
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
                { label: "Close tab", click: () => closeProjectTab(tabId, true) },
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
            active: row.tabId === activeTabId && !isPage(mainView),
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
            {instance().label && (
                <div style={{ padding: `${fullScreen ? 6 : 30}px 12px 6px`, background: T.brick, color: T.ground, fontFamily: T.mono, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textAlign: "center", WebkitAppRegion: "drag" } as React.CSSProperties}>
                    {instance().label.toUpperCase()} INSTANCE · NOT YOUR WINTOS
                </div>
            )}
            {/* The header drags the window, as a macOS title bar would; nothing in it is clickable. Its
                top clears the window buttons, which sit over the sidebar; full screen has none. */}
            <div style={{ padding: `${fullScreen ? 12 : 36}px 16px 13px`, display: "flex", alignItems: "flex-end", justifyContent: "space-between", WebkitAppRegion: "drag" } as React.CSSProperties}>
                <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    <span style={{ fontFamily: T.display, fontSize: 21, lineHeight: 1 }}>WintOS</span>
                    <span style={{ fontFamily: T.mono, fontSize: 10, color: T.muted }}>
                        <DateTime />
                    </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                    {state?.keyboard && <GameChip stats={state.keyboard} />}
                    <span style={{ fontFamily: T.mono, fontSize: 10, color: T.muted }}>{tabIds.length} {tabIds.length === 1 ? "project" : "projects"}</span>
                </div>
            </div>
            <div
                data-wintos="sidebar-list"
                style={{ flexGrow: 1, overflowY: "auto", padding: "4px 12px 12px", display: "flex", flexDirection: "column", gap: 18 }}
            >
                {state && (
                    <div style={{ display: "flex", gap: 8 }}>
                        {queue ? (
                            <SummaryCard label="PRs" keys="⇧⌘G" busy={running.has("gh-prs")} stats={[{ value: String(queue.yours), label: "yours" }, { value: String(queue.team), label: "team" }]} note={queue.pastSla ? `${queue.pastSla} past SLA` : undefined} noteColor={T.brick} active={shows("prs")} onClick={() => goToInbox("prs")} />
                        ) : (
                            <SummaryCard label="PRs" keys="⇧⌘G" stats={[]} note="loading from GitHub" noteColor={T.faint} active={shows("prs")} onClick={() => goToInbox("prs")} />
                        )}
                        {panels.map((p) => {
                            const c = cardValue(p.counts);
                            const failed = p.error || p.counts.some((x) => x.count == null);
                            return <SummaryCard key={p.name} label={p.title} keys="⇧⌘O" busy={running.has(p.name)} stats={c} note={failed ? "couldn't fetch everything" : undefined} noteColor={T.brick} active={shows("oncall")} onClick={() => goToInbox("oncall")} />;
                        })}
                        {loading.map((p) => <SummaryCard key={p.name} label={p.title} keys="⇧⌘O" stats={[]} note="loading" noteColor={T.faint} active={shows("oncall")} onClick={() => goToInbox("oncall")} />)}
                    </div>
                )}
                {state?.day && <TodayCard day={state.day} active={mainView === "day"} walk={<WalkKeys />} />}
                {meetings.length > 0 && <MeetingCard meetings={meetings} />}
                <MeetingEdge meetings={meetings} />
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
                                    tabIndex={-1}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => setShowAll(!showAll)}
                                    style={{ margin: "4px 13px 0", padding: "7px 0", background: "transparent", border: "none", borderTop: `1px solid #32302f`, textAlign: "left", fontFamily: T.ui, fontSize: 11.5, color: T.muted, cursor: "pointer" }}
                                >
                                    {showAll ? "Show fewer" : `Show all ${model.quiet.length + model.quietMore.length + model.quietStale.length}`}
                                    {!showAll && model.quietStale.length > 0 && (
                                        <span style={{ color: T.faint }}> · includes {model.quietStale.length} untouched over two weeks</span>
                                    )}
                                </button>
                            )}
                        </Band>
                        <Band kind="snoozed" count={model.snoozed.length} shown={snoozedShown.length}>
                            {snoozedShown.map(renderRow)}
                            {(showSnoozed || snoozedShown.length < model.snoozed.length) && (
                                <button
                                    type="button"
                                    tabIndex={-1}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => setShowSnoozed(!showSnoozed)}
                                    style={{ margin: "4px 13px 0", padding: "7px 0", background: "transparent", border: "none", textAlign: "left", fontFamily: T.ui, fontSize: 11.5, color: T.faint, cursor: "pointer" }}
                                >
                                    {showSnoozed ? "Hide snoozed" : `Show ${model.snoozed.length} snoozed · opening one wakes it`}
                                </button>
                            )}
                        </Band>
                    </>
                )}
            </div>
            {state?.keyboard && <GameLine stats={state.keyboard} />}
            <div style={{ flexShrink: 0, minHeight: 34, boxSizing: "border-box", padding: "6px 14px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 16px", borderTop: `1px solid ${T.hairline}`, fontSize: 11, color: T.faint }}>
                {/* ⌘J/⌘K sit on the open project's row. */}
                <Key k="⌃⇥" label="waiting" />
                {!isInboxTab(tabs[activeTabId]) && <Key k="⌘R" label="rename" />}
                {!isInboxTab(tabs[activeTabId]) && <Key k="⌥⌘Z" label={isSnoozedHere ? "wake" : "snooze"} />}
                {state?.sessions.some((x) => x.tabId === activeTabId && x.state === "waiting") && <Key k="⌥⌘P" label="park" />}
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
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: kind === "quiet" ? "#3c3836" : s.color }} />
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: s.color }}>{s.label}</span>
                <span style={{ flexGrow: 1, height: 1, background: kind === "quiet" ? "#32302f" : T.hairline }} />
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
    const ref = useRef<HTMLInputElement>(null);
    useZoneKeys(ref, { Enter: () => onRename(ref.current?.value ?? null), Escape: () => onRename(null) });
    if (!renaming) return <span style={style}>{v.title}</span>;
    return (
        <input
            autoFocus
            ref={ref}
            data-zone="overlay"
            defaultValue={v.title}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => onRename(e.currentTarget.value)}
            style={{ ...style, background: T.ground, border: `1px solid ${T.borderActive}`, borderRadius: 5, padding: "1px 4px", outline: "none", width: "100%" }}
        />
    );
}

// The open project: a brighter row with a bar on its left, unmistakable at a glance (green is
// taken by the focus frame), and the keys that walk away from it.
const WalkKeys = () => (
    <span style={{ display: "inline-flex", gap: 8 }}>
        <Key k="⌘K" label="↑" />
        <Key k="⌘J" label="↓" />
    </span>
);

function CardRow(p: RowProps) {
    const { v } = p;
    const tone = { apricot: T.apricot, brick: T.brick, secondary: T.secondary }[v.tone ?? "secondary"];
    return (
        <div
            data-tabid={p.tabId}
            data-band="card"
            data-key="⌘J / ⌘K"
            onClick={p.onOpen}
            onContextMenu={p.onMenu}
            style={{
                display: "flex",
                flexDirection: "column",
                gap: 7,
                padding: "12px 13px",
                cursor: "pointer",
                borderRadius: 10,
                background: T.card,
                border: `1px solid ${p.cursor ? T.apricot : p.active ? T.borderActive : T.border}`,
                ...(p.active ? ACTIVE : {}),
            }}
        >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <Title v={v} renaming={p.renaming} onRename={p.onRename} style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.005em", color: p.active ? T.emphasis : T.title, fontFamily: T.ui }} />
                <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    {p.active && <WalkKeys />}
                    <span style={{ fontFamily: T.mono, fontSize: 10, color: T.muted }}>{v.age}</span>
                </span>
            </div>
            {v.next && <div style={{ fontSize: 12.5, lineHeight: 1.4, color: tone, textWrap: "pretty" } as React.CSSProperties}><Rich text={v.next} size="rail" links={false} /></div>}
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
            data-key="⌘J / ⌘K"
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
                background: "transparent",
                border: `1px solid ${p.cursor ? T.apricot : "transparent"}`,
                ...(p.active ? ACTIVE : {}),
            }}
        >
            {/* The title gets the room; the note is capped and cut, so neither wraps. */}
            <Title v={v} renaming={p.renaming} onRename={p.onRename} style={{ flexGrow: 1, minWidth: 0, fontSize: 13, color: p.active ? T.emphasis : T.quietTitle, fontFamily: T.ui, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} />
            {p.active ? <WalkKeys /> : <span title={v.reason} style={{ maxWidth: "48%", fontSize: 10.5, color: v.tone === "brick" ? T.brick : T.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.tone === "brick" ? "note unreadable" : v.reason}</span>}
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

// A refresh in flight while the old numbers stay up: three dots tapping in turn, quiet enough
// to ignore.
function Drumming() {
    return (
        <span style={{ display: "inline-flex", gap: 3 }} aria-label="updating">
            <style>{"@keyframes wintos-drum{0%,60%,100%{transform:translateY(0);opacity:.35}30%{transform:translateY(-2px);opacity:1}}"}</style>
            {[0, 1, 2].map((i) => (
                <span key={i} style={{ width: 3, height: 3, borderRadius: "50%", background: T.muted, animation: `wintos-drum 1.2s ${i * 0.15}s infinite ease-in-out` }} />
            ))}
        </span>
    );
}

// A title over its numbers, each number stacked on its own label; the note is only for what
// the numbers can't say (late, updating, loading).
function SummaryCard({ label, keys, stats, note, noteColor, busy, active, onClick }: { label: string; keys: string; stats: CardStat[]; note?: string; noteColor: string; busy?: boolean; active?: boolean; onClick: () => void }) {
    return (
        <div data-key={keys} onClick={onClick} style={{ flexGrow: 1, flexBasis: 0, padding: "11px 13px", background: "#32302f", border: `1px solid ${active ? T.borderActive : "#3c3836"}`, borderRadius: 10, display: "flex", flexDirection: "column", gap: 8, cursor: "pointer", ...(active ? ACTIVE : {}) }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, fontWeight: 600, color: T.secondary }}>
                {label}
                {busy && <Drumming />}
                <span style={{ marginLeft: "auto" }}>
                    <Key k={keys} label="" />
                </span>
            </span>
            <span style={{ display: "flex", gap: 18 }}>
                {stats.map((s) => (
                    <span key={s.label} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <span style={{ fontFamily: T.display, fontSize: 24, lineHeight: 1, color: T.text }}>{s.value}</span>
                        <span style={{ fontFamily: T.mono, fontSize: 9.5, color: T.muted }}>{s.label}</span>
                    </span>
                ))}
            </span>
            {note && <span style={{ fontFamily: T.mono, fontSize: 9.5, color: noteColor }}>{note}</span>}
            {/* In PRs or On call no project row is open: the walk keys sit on this card instead. */}
            {active && (
                <span style={{ alignSelf: "flex-start" }}>
                    <WalkKeys />
                </span>
            )}
        </div>
    );
}

// A sidebar toggle kept in localStorage, which every project's renderer shares: one setting for
// all projects, like the notes rail's width.
function useStoredFlag(key: string): [boolean, (on: boolean) => void] {
    const read = () => {
        try {
            return localStorage.getItem(key) === "1";
        } catch {
            return false;
        }
    };
    const [on, setOn] = useState(read);
    useEffect(() => {
        const sync = () => setOn(read());
        window.addEventListener("storage", sync);
        document.addEventListener("visibilitychange", sync);
        return () => (window.removeEventListener("storage", sync), document.removeEventListener("visibilitychange", sync));
    }, []);
    return [
        on,
        (next) => {
            setOn(next);
            try {
                localStorage.setItem(key, next ? "1" : "0");
            } catch {}
        },
    ];
}
