import { ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getWaveObjectAtom, makeORef, reloadWaveObject } from "@/app/store/wos";
import type { Session } from "../daemon/sessions/reduce";
import { atoms, getApi } from "@/store/global";
import { fireAndForget } from "@/util/util";
import { atom, useAtom, useAtomValue } from "jotai";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Row } from "../daemon/ranking/rank";
import { Key } from "./Key";
import { Rich } from "./notes/ProjectNotes";
import { MeetingCard, MeetingEdge } from "./MeetingCard";
import { closedWakes, useWakeDelivery, type ClosedWake } from "./wakes";
import { useSchemeNotices } from "./schemeNotices";
import { TodayCard } from "./TodayCard";
import { meetingsFrom } from "./meetings";
import { ACTIVE, T } from "./tokens";
import { useNow } from "./useNow";
import { editMine, enterProject, focusArea, reopenProject, resumePane, setLatestSessions } from "./focus";
import { setSwitchOrder, setWakeStops, switchTargetAtom } from "./switcher";
import { closeProjectTab, openView, registerWintosMenu, runKey } from "./menu";
import { focusList } from "./dayplan";
import type { Day } from "../daemon/journal/journal";
import { isPage, mainViewAtom, renamingAtom, tickModeAtom, yourMoveAtom } from "./notes/state";
import { inFlight, liveSessions } from "./sessions";
import { instance, setProjectTitle, useWintos } from "./useWintos";
import { attention } from "./attention";
import { ghPrs, inboxKind, isInboxTab, type InboxList, prRef, projectTabIds, relTime, RowView, type WintosState } from "./view";
import { queueModel } from "./prs";
import { goToInbox } from "./inbox";
import { useZoneKeys } from "./zones";
import { cardValue, loadingPanels, pluginPanels, type CardStat } from "./panels";

const BATCH_WORTH = 2;

const BAND_STYLE = {
    needs: { label: "Your move", color: T.apricot },
    read: { label: "To read", color: T.blue },
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

// This renderer hears about another tab's panes only when it loads that tab, so a session in a pane
// opened there since would be dropped as gone (liveSessions) and its project shown quiet. Such a
// tab is reloaded, once per pane, before its list is trusted.
function useFreshPaneLists(sessions: Session[] | undefined, tabs: Record<string, Tab | undefined>): void {
    const asked = useRef(new Set<string>());
    useEffect(() => {
        for (const s of sessions ?? []) {
            const known = tabs[s.tabId]?.blockids;
            if (!known || known.includes(s.blockId) || s.state === "ended" || asked.current.has(s.blockId)) continue;
            asked.current.add(s.blockId);
            void reloadWaveObject(makeORef("tab", s.tabId));
        }
    }, [sessions, tabs]);
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
    useWakeDelivery(raw?.wakes, raw?.sessions, raw?.shelf?.[activeTabId], activeTabId);
    useSchemeNotices(raw?.sessions, activeTabId);
    const wokeClosed = raw ? closedWakes(raw.wakes ?? {}, raw.shelf ?? {}, raw.projects, tabIds, (u) => prRef(raw, u)) : [];
    useFreshPaneLists(raw?.sessions, tabs);
    const state = raw && { ...raw, sessions: liveSessions(raw.sessions, Object.fromEntries(tabIds.map((id) => [id, tabs[id]?.blockids]))) };
    const now = useNow();
    const fullScreen = useAtomValue(atoms.isFullScreen);
    const mainView = useAtomValue(mainViewAtom);
    const [showAll, setShowAll] = useStoredFlag("wintos:quiet-unfolded");
    const ticking = useAtomValue(tickModeAtom);
    const switchTarget = useAtomValue(switchTargetAtom);
    const [renaming, setRenaming] = useAtom(renamingAtom);

    const model = state ? attention(tabIds, state, names, now, activeTabId) : null;
    const focus = state?.rhythm?.focus && now < state.rhythm.focus.until ? state.rhythm.focus : undefined;
    const gh = state ? ghPrs(state) : undefined;
    const queue = gh ? queueModel(gh.prs, gh.me, now, state?.snoozes) : null;
    const panels = state ? pluginPanels(state) : [];
    const loading = state ? loadingPanels(state, lastPanelTitles(panels)) : [];
    const running = new Set(state?.pluginsRunning ?? []);
    const meetings = useMemo(() => meetingsFrom(state?.plugins), [state?.plugins]);
    // The open tab is always visible even when it is stale; walking with ⌘J/⌘K or renaming
    // (the row must exist to hold the input) shows them all.
    const expanded = showAll || switchTarget != null || renaming != null;
    // Quiet folds to one line, the open project kept: what is not for you now steps back.
    const allQuiet = model ? [...model.quiet, ...model.quietMore, ...model.quietStale] : [];
    const quiet = expanded ? allQuiet : allQuiet.filter((r) => r.tabId === activeTabId);
    // The cards above the projects are walked too, in the order they show: PRs, On call, Today.
    const cards = [...(state?.day ? ["card:today"] : []), ...(gh || state ? ["card:prs"] : []), ...(panels.length || loading.length ? ["card:oncall"] : [])];
    const switchOrder = model ? [...cards, ...wokeClosed.map((w) => `wake:${w.projectId}`), ...[...model.needs, ...model.read, ...model.running, ...model.quiet, ...model.quietMore, ...model.quietStale].map((r) => r.tabId)] : [];

    useEffect(registerWintosMenu, []);

    useEffect(() => void setSwitchOrder(switchOrder), [switchOrder.join(",")]);
    const reopenWoke = (w: ClosedWake) => reopenProject(w.projectId, [resumePane(w.script)]);
    useEffect(() => void setWakeStops(Object.fromEntries(wokeClosed.map((w) => [`wake:${w.projectId}`, () => reopenWoke(w)]))), [wokeClosed.map((w) => w.sessionId).join(",")]);
    useEffect(() => void document.querySelector(`[data-wintos=sidebar-list] [data-tabid="${switchTarget}"]`)?.scrollIntoView({ block: "nearest" }), [switchTarget]);

    useEffect(() => {
        if (state) setLatestSessions(state.sessions, model?.targets ?? {});
    }, [state, tabIds.join(",")]);
    const yourMove = model ? model.needs.length + wokeClosed.length : 0;
    useEffect(() => void globalStore.set(yourMoveAtom, yourMove), [yourMove]);

    // The project title is the source of truth; the tab name follows it.
    useEffect(() => {
        for (const p of state?.projects ?? []) {
            if (p.id && p.title && tabIds.includes(p.id) && names[p.id] !== p.title)
                fireAndForget(() => RpcApi.UpdateTabNameCommand(TabRpcClient, p.id!, p.title!));
        }
    }, [state, names]);

    // The open project with something that needs you lands on its session too; else the terminals.
    const open = (tabId: string) => (tabId !== activeTabId || model?.targets[tabId] ? enterProject(tabId) : focusArea("terminal"));
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
        const v = model!.views[row.tabId];
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
        const el = row.band === "quiet" ? <QuietRow {...props} /> : row.band === "running" ? <QuietRow {...props} v={{ ...v, reason: v.next }} dot={T.moss} /> : <CardRow {...props} />;
        // A focus block dims the other projects: they wait for it to end.
        return focus && row.tabId !== focus.tabId ? <div key={row.tabId} style={{ opacity: 0.45 }}>{el}</div> : el;
    };

    return (
        <div data-wintos="sidebar" style={{ height: "100%", display: "flex", flexDirection: "column", background: T.sidebar, borderRight: `1px solid ${T.border}`, fontFamily: T.ui, color: T.text }}>
            {instance().label && (
                <div style={{ padding: `${fullScreen ? 6 : 30}px 12px 6px`, background: T.brick, color: T.ground, fontFamily: T.mono, fontSize: 11.5, fontWeight: 700, letterSpacing: "0.06em", textAlign: "center", WebkitAppRegion: "drag" } as React.CSSProperties}>
                    {instance().label.toUpperCase()} INSTANCE · NOT YOUR WINTOS
                </div>
            )}
            {/* The header drags the window, as a macOS title bar would; nothing in it is clickable. Its
                top clears the window buttons, which sit over the sidebar; full screen has none. */}
            <div style={{ padding: `${fullScreen ? 12 : 36}px 16px 13px`, display: "flex", flexDirection: "column", gap: 4, WebkitAppRegion: "drag" } as React.CSSProperties}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ fontFamily: T.display, fontSize: 27, lineHeight: 1 }}>WintOS</span>
                    <Clock />
                </div>
            </div>
            <div
                data-wintos="sidebar-list"
                style={{ flexGrow: 1, overflowY: "auto", padding: "4px 12px 12px", display: "flex", flexDirection: "column", gap: 18 }}
            >
                {/* ⌥⌘X unfolds the Today card to tick items off; otherwise the day, the PRs and on call are three tiles. */}
                {state?.day && ticking ? (
                    <TodayCard day={state.day} active={mainView === "day" || mainView === "reflect"} cursor={switchTarget === "card:today"} walk={<WalkKeys />} />
                ) : (
                    state && (
                        <div style={{ display: "grid", gridTemplateColumns: `repeat(${1 + (state.day ? 1 : 0) + Math.max(1, panels.length + loading.length)}, minmax(0, 1fr))`, gap: 6 }}>
                            {state.day && <Tile label="Today" keys="⇧⌘Y" value={dayValue(state.day)} hot={!state.day.planned} active={mainView === "day" || mainView === "reflect"} cursor={switchTarget === "card:today"} onClick={() => openView("day")} />}
                            <Tile label="PRs" keys="⇧⌘G" value={queue ? String(queue.yours) : "…"} note={queue && queue.pastSla ? `${queue.pastSla} late` : undefined} busy={running.has("gh-prs")} active={shows("prs")} cursor={switchTarget === "card:prs"} onClick={() => goToInbox("prs")} />
                            {panels.map((p) => <Tile key={p.name} label={p.title} keys="⇧⌘O" value={cardValue(p.counts).map((c) => c.value).join(" · ")} broken={!!p.error || p.counts.some((x) => x.count == null)} busy={running.has(p.name)} active={shows("oncall")} cursor={switchTarget === "card:oncall"} onClick={() => goToInbox("oncall")} />)}
                            {loading.map((p) => <Tile key={p.name} label={p.title} keys="⇧⌘O" value="…" active={shows("oncall")} cursor={switchTarget === "card:oncall"} onClick={() => goToInbox("oncall")} />)}
                        </div>
                    )
                )}
                {state?.day?.reflection && (
                    <button type="button" data-wintos="reflect-nudge" data-key="⌥⌘Y" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => openView("reflect")} style={{ display: "flex", justifyContent: "space-between", gap: 8, margin: "-8px 2px 0", padding: 0, background: "transparent", border: "none", cursor: "pointer", fontFamily: T.ui, fontSize: 12.5, color: T.apricot, textAlign: "left" }}>
                        Write your {state.day.reflection.level} reflection
                        <Key k="⌥⌘Y" label="" />
                    </button>
                )}
                {meetings.length > 0 && <MeetingCard meetings={meetings} />}
                <MeetingEdge meetings={meetings} />
                {offline || !model ? (
                    <div style={{ fontFamily: T.mono, fontSize: 11, color: offline ? T.brick : T.muted, padding: "0 4px" }}>
                        {offline ? "daemon offline: bands hidden until wintosd is back" : "connecting to wintosd…"}
                    </div>
                ) : (
                    <>
                        {focus && (
                            <button type="button" data-wintos="focus-block" data-key="⌥⌘F" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => runKey("focus")} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 12px", background: T.card, border: `1px solid ${T.moss}`, borderRadius: 10, cursor: "pointer", fontFamily: T.ui, textAlign: "left" }}>
                                <span style={{ fontSize: 12.5, color: T.text, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Focus · {state?.projects.find((p) => p.id === focus.tabId)?.title ?? names[focus.tabId] ?? "this project"}</span>
                                <span style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                                    <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.moss }}>{Math.ceil((focus.until - now) / 60_000)} min left{model.held ? ` · ${model.held.count} held` : ""}</span>
                                    <Key k="⌥⌘F" label="" />
                                </span>
                            </button>
                        )}
                        <Band kind="needs" count={model.needs.length + wokeClosed.length} note={model.held ? (
                            <button type="button" data-wintos="held" data-key="⌥⌘O" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => runKey("release")} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, margin: "0 4px", padding: 0, background: "transparent", border: "none", cursor: "pointer", fontFamily: T.ui, fontSize: 11.5, color: T.muted, textAlign: "left" }}>
                                <span>{model.held.count} held · {model.held.until === Infinity ? "until you are back" : `opens ${new Date(model.held.until).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`}</span>
                                <Key k="⌥⌘O" label="now" />
                            </button>
                        ) : model.needs.length >= BATCH_WORTH && (
                            // Enough waiting to be worth a sitting: say where the batch is.
                            <button type="button" data-wintos="batch-ready" data-key="⌥⌘O" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => runKey("release")} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, margin: "0 4px", padding: 0, background: "transparent", border: "none", cursor: "pointer", fontFamily: T.ui, fontSize: 11.5, color: T.muted, textAlign: "left" }}>
                                <span>{model.needs.length} to decide in one go</span>
                                <Key k="⌥⌘O" label="batch" />
                            </button>
                        )}>
                            {wokeClosed.map((w) => (
                                <CardRow key={`wake:${w.sessionId}`} tabId={`wake:${w.projectId}`} v={{ title: w.title, next: w.line, tone: "apricot", age: relTime(Date.now() - w.due), meta: "closed · ⌃⇥ or ⌘J/⌘K opens it" }} active={false} cursor={switchTarget === `wake:${w.projectId}`} renaming={false} onOpen={() => reopenWoke(w)} onMenu={(e) => e.preventDefault()} onRename={() => {}} />
                            ))}
                            {model.needs.map(renderRow)}
                        </Band>
                        <Band kind="read" count={model.read.length}>{model.read.map(renderRow)}</Band>
                        <Band kind="running" count={model.running.length}>{model.running.map(renderRow)}</Band>
                        <Band kind="quiet" count={model.quiet.length + model.quietMore.length} shown={quiet.length}>
                            {quiet.map(renderRow)}
                            {allQuiet.length > quiet.length || showAll ? (
                                <button
                                    type="button"
                                    data-wintos="quiet-fold"
                                    data-key="⌥⌘S"
                                    tabIndex={-1}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => setShowAll(!showAll)}
                                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, margin: "2px 4px 0", padding: "5px 0", background: "transparent", border: "none", textAlign: "left", fontFamily: T.ui, fontSize: 12.5, color: T.faint, cursor: "pointer" }}
                                >
                                    <span>{showAll ? "Fold the quiet ones" : `${allQuiet.length - quiet.length} quiet${model.held ? ` · ${model.held.count} held for the batch` : ""}`}</span>
                                    <Key k="⌥⌘S" label="" />
                                </button>
                            ) : null}
                        </Band>
                    </>
                )}
            </div>
            {state && <RhythmMeter state={state} />}
        </div>
    );
});
WintOSSidebar.displayName = "WintOSSidebar";

// The sidebar's foot: the sessions in flight against your limit (WINTOS_WIP), green at work,
// apricot waiting on you, and how long since your last break.
function RhythmMeter({ state }: { state: WintosState }) {
    const now = useNow(60_000);
    const limit = state.wip ?? 0;
    const n = inFlight(state.sessions, now);
    const total = n.working + n.waiting;
    const r = state.rhythm;
    const marks = Array.from({ length: Math.min(12, Math.max(limit, total)) }, (_, i) => (i < n.working ? T.moss : i < total ? T.apricot : T.borderActive));
    const since = r ? Math.round((now - r.stretchFrom) / 60_000) : 0;
    const rest = !r?.everyMs ? "" : r.onBreak ? "on a break" : r.breaks.length ? `last break ${since} min ago` : `no break yet · ${since} min at it`;
    if (!marks.length && !rest) return null;
    return (
        <div data-wintos="rhythm-meter" style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: 7, padding: "10px 16px 12px" }}>
            {marks.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${marks.length}, minmax(0, 1fr))`, gap: 3 }}>
                    {marks.map((c, i) => <span key={i} style={{ height: 4, borderRadius: 2, background: c }} />)}
                </div>
            )}
            <span style={{ fontFamily: T.mono, fontSize: 11.5, color: total >= limit && limit ? T.apricot : T.faint }}>{[limit ? `${total} of ${limit} in flight` : "", rest].filter(Boolean).join(" · ")}</span>
        </div>
    );
}

// The day as a tile: how much of the plan is done, or that it still needs one.
const dayValue = (day: Day) => {
    const items = focusList(day.focus).filter((i) => i.depth === 0);
    return !day.planned ? "plan it" : items.length ? `${items.filter((i) => i.done).length} of ${items.length}` : "–";
};

// A small tile at the top of the sidebar: Today, PRs, On call. hot: it needs you (an unplanned
// day); note: what is late, in brick; broken: its last run could not fetch everything.
function Tile({ label, keys, value, note, hot, broken, busy, active, cursor, onClick }: { label: string; keys: string; value: string; note?: string; hot?: boolean; broken?: boolean; busy?: boolean; active?: boolean; cursor?: boolean; onClick: () => void }) {
    return (
        <div data-key={active ? "" : keys} onClick={onClick} title={broken ? "couldn't fetch everything" : undefined} style={{ minWidth: 0, padding: "8px 10px", background: T.card, border: `1px solid ${cursor || hot ? T.apricot : "transparent"}`, borderRadius: 9, display: "flex", flexDirection: "column", gap: 2, cursor: "pointer", ...(active ? ACTIVE : {}) }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: T.muted }}>
                {label}
                {busy && <Drumming />}
                <span style={{ marginLeft: "auto" }}><Key k={keys} label="" /></span>
            </span>
            <span style={{ fontSize: 15, fontWeight: 600, color: hot ? T.apricot : broken ? T.brick : T.emphasis, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {value}
                {note && <span style={{ fontSize: 12, fontWeight: 500, color: T.brick }}> · {note}</span>}
            </span>
        </div>
    );
}

// note: a line under the header, shown even when the band has no rows (Your move's held items).
function Band({ kind, count, shown, note, children }: { kind: keyof typeof BAND_STYLE; count: number; shown?: number; note?: React.ReactNode; children: React.ReactNode }) {
    if (!count && !note) return null;
    const s = BAND_STYLE[kind];
    return (
        <div data-band-group={kind} style={{ display: "flex", flexDirection: "column", gap: kind === "quiet" ? 3 : 7 }}>
            <span style={{ padding: "0 4px", fontSize: 12, fontWeight: 600, letterSpacing: "0.03em", color: kind === "quiet" ? T.faint : kind === "running" ? T.quietTitle : s.color }}>
                {s.label} · {shown !== undefined && shown < count ? `${shown} of ${count}` : count}
            </span>
            {note}
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

// The open project: a brighter row with a bar on its left, unmistakable at a glance, and the keys
// that walk away from it. The arrows mean nothing without their keys, so they show with them.
const WalkKeys = () => (
    <span className="w-keycap" style={{ display: "inline-flex", gap: 8 }}>
        <Key k="⌘K" label="↑" />
        <Key k="⌘J" label="↓" />
    </span>
);

function CardRow(p: RowProps) {
    const { v } = p;
    const tone = { apricot: T.apricot, blue: T.blue, brick: T.brick, secondary: T.secondary }[v.tone ?? "secondary"];
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
                    <span style={{ fontFamily: T.mono, fontSize: 11, color: T.muted }}>{v.age}</span>
                </span>
            </div>
            {v.next && <div style={{ fontSize: 12.5, lineHeight: 1.4, color: tone, textWrap: "pretty" } as React.CSSProperties}><Rich text={v.next} size="rail" links={false} /></div>}
            {v.meta && <div title={v.meta} style={{ fontFamily: T.mono, fontSize: 10.5, color: T.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.meta}</div>}
        </div>
    );
}

// dot: a running project's mark before its title; its line is what it is doing.
function QuietRow(p: RowProps & { dot?: string }) {
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
            {p.dot && <span style={{ width: 6, height: 6, borderRadius: "50%", background: p.dot, flexShrink: 0, marginRight: -2 }} />}
            <Title v={v} renaming={p.renaming} onRename={p.onRename} style={{ flexGrow: 1, minWidth: 0, fontSize: 13, color: p.active ? T.emphasis : T.quietTitle, fontFamily: T.ui, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} />
            {p.active ? <WalkKeys /> : <span title={v.reason} style={{ maxWidth: "48%", fontSize: 11.5, color: v.tone === "brick" ? T.brick : T.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.tone === "brick" ? "note unreadable" : v.reason}</span>}
        </div>
    );
}


// Its own component so the per-second tick re-renders only this line, not the sidebar.
function Clock() {
    const d = new Date(useNow(1_000));
    return <span style={{ fontFamily: T.mono, fontSize: 13, color: T.muted, fontVariantNumeric: "tabular-nums" }}>{d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}</span>;
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
function SummaryCard({ label, keys, stats, note, noteColor, busy, active, cursor, onClick }: { label: string; keys: string; stats: CardStat[]; note?: string; noteColor: string; busy?: boolean; active?: boolean; cursor?: boolean; onClick: () => void }) {
    return (
        <div data-key={active ? "" : keys} onClick={onClick} style={{ flexGrow: 1, flexBasis: 0, padding: "11px 13px", background: T.card, border: `1px solid ${cursor ? T.apricot : active ? T.borderActive : T.border}`, borderRadius: 10, display: "flex", flexDirection: "column", gap: 8, cursor: "pointer", ...(active ? ACTIVE : {}) }}>
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
                        <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.muted }}>{s.label}</span>
                    </span>
                ))}
            </span>
            {note && <span style={{ fontFamily: T.mono, fontSize: 10.5, color: noteColor }}>{note}</span>}
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
