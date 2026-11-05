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
import { meetingsFrom } from "./meetings";
import { ACTIVE, T } from "./tokens";
import { useNow } from "./useNow";
import { editMine, enterProject, focusArea, focusSession, openBackground, reopenProject, resumePane, setLatestSessions } from "./focus";
import { getLayoutModelForStaticTab } from "@/layout/index";
import { setSwitchOrder, setWakeStops, switchTargetAtom } from "./switcher";
import { closeProjectTab, openView, registerWintosMenu, runKey, SIDEBAR_BY_EPIC } from "./menu";
import { isPage, mainViewAtom, newStepEpicAtom, renamingAtom, yourMoveAtom } from "./notes/state";
import { inFlight, liveSessions } from "./sessions";
import { instance, setProjectTitle, useWintos } from "./useWintos";
import { attention } from "./attention";
import { ghPrs, inboxKind, isInboxTab, type InboxList, prRef, projectTabIds, relTime, RowView, sessionName, type WintosState } from "./view";
import { queueModel } from "./prs";
import { goToInbox } from "./inbox";
import { useZoneKeys } from "./zones";
import { cardValue, loadingPanels, pluginPanels, type CardStat } from "./panels";
import { EpicAvatar } from "./EpicAvatar";
import { PinnedEpics } from "./PinnedEpics";
import { EpicGroups, groupByEpic } from "./EpicGroups";
import { useEpicReports } from "./epicReports";
import { lookOf, NO_EPIC, type Look } from "./epicLook";

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
    const lookingAt = useAtomValue(getLayoutModelForStaticTab().focusedNode)?.data?.blockId;
    useEpicReports(raw?.epicReports, raw?.sessions, activeTabId, useNow(15_000), typeof document !== "undefined" && document.hasFocus() ? lookingAt : undefined, raw?.relays, raw?.epics);
    useSchemeNotices(raw?.sessions, activeTabId);
    const wokeClosed = raw ? closedWakes(raw.wakes ?? {}, raw.shelf ?? {}, raw.projects, tabIds, (u) => prRef(raw, u)) : [];
    // Sessions the epic agents started in the background (no pane): one waiting on you is in Your move.
    const background = (raw?.sessions ?? []).filter((s) => s.bgId && !s.attachedTo && s.state !== "ended");
    const bgNeeds = background.filter((s) => s.state === "waiting");
    const wakeNeeds = wokeClosed.filter((w) => !w.news);
    const wakeNews = wokeClosed.filter((w) => w.news);
    useFreshPaneLists(raw?.sessions, tabs);
    const state = raw && { ...raw, sessions: liveSessions(raw.sessions, Object.fromEntries(tabIds.map((id) => [id, tabs[id]?.blockids]))) };
    const now = useNow();
    const fullScreen = useAtomValue(atoms.isFullScreen);
    const mainView = useAtomValue(mainViewAtom);
    const [showAll, setShowAll] = useStoredFlag("wintos:quiet-unfolded");
    const [byEpic] = useStoredFlag(SIDEBAR_BY_EPIC);
    const switchTarget = useAtomValue(switchTargetAtom);
    const [renaming, setRenaming] = useAtom(renamingAtom);

    const model = state ? attention(tabIds, state, names, now, activeTabId, true) : null;
    // Which session row is the one you are in: the focused pane's, in this renderer's tab.
    const focusedBlock = useAtomValue(getLayoutModelForStaticTab().focusedNode)?.data?.blockId;
    const gh = state ? ghPrs(state) : undefined;
    const queue = gh ? queueModel(gh.prs, gh.me, now, state?.snoozes, gh.team) : null;
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
    const openEpics = (state?.epics ?? []).filter((e) => !e.done).length;
    const epicsWaiting = new Set((state?.sessions ?? []).filter((x) => x.epic && x.state === "waiting").map((x) => x.epic)).size;
    const pinned = (state?.epics ?? []).filter((e) => e.pinned && !e.done);
    const cards = [...(state ? ["card:today"] : []), ...(gh || state ? ["card:prs"] : []), ...(panels.length || loading.length ? ["card:oncall"] : [])];
    const byState = model ? [...model.needs, ...model.read, ...model.running, ...model.quiet, ...model.quietMore, ...model.quietStale] : [];
    const groups = byEpic ? groupByEpic(byState, state?.epics ?? []) : [];
    const listed = byEpic ? groups.flatMap((g) => g.rows) : byState;
    const stops = byEpic ? groups.flatMap((g) => [...(g.epic ? [`epic:${g.epic.id}`] : []), ...g.rows.map((r) => r.key)]) : [...pinned.map((e) => `epic:${e.id}`), ...listed.map((r) => r.key)];
    const switchOrder = model ? [...cards, ...bgNeeds.map((s) => `bg:${s.id}`), ...wokeClosed.map((w) => `wake:${w.projectId}`), ...stops] : [];
    const tabOfRow = Object.fromEntries(listed.map((r) => [r.key, r.tabId]));

    useEffect(registerWintosMenu, []);

    // By epic, an agent's row is its epic's header: ⌃⇥ stops there when the agent needs you.
    const asStop = Object.fromEntries(groups.flatMap((g) => (g.agent && g.epic ? [[g.agent.key, `epic:${g.epic.id}`]] : [])));
    const needKeys = model ? [...bgNeeds.map((s) => `bg:${s.id}`), ...wakeNeeds.map((w) => `wake:${w.projectId}`), ...model.needs.map((r) => asStop[r.key] ?? r.key)] : [];
    const readKeys = model ? [...wakeNews.map((w) => `wake:${w.projectId}`), ...model.read.map((r) => asStop[r.key] ?? r.key)] : [];
    useEffect(() => void setSwitchOrder(switchOrder, tabOfRow, needKeys, readKeys), [switchOrder.join(","), needKeys.join(","), readKeys.join(",")]);
    const reopenWoke = (w: ClosedWake) => reopenProject(w.projectId, [resumePane(w.script)]);
    useEffect(() => void setWakeStops(Object.fromEntries([...wokeClosed.map((w) => [`wake:${w.projectId}`, () => reopenWoke(w)] as const), ...bgNeeds.map((s) => [`bg:${s.id}`, () => openBackground(s.bgId!)] as const)])), [wokeClosed.map((w) => w.sessionId).join(","), bgNeeds.map((s) => s.id).join(",")]);
    useEffect(() => void document.querySelector(`[data-wintos=sidebar-list] [data-row="${switchTarget}"]`)?.scrollIntoView({ block: "nearest" }), [switchTarget]);

    useEffect(() => {
        if (state) setLatestSessions(state.sessions, model?.targets ?? {});
    }, [state, tabIds.join(",")]);
    const yourMove = model ? model.needs.length + wakeNeeds.length + bgNeeds.length : 0;
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
        const v = model!.views[row.key];
        const own = row.key !== row.tabId ? row.sessions[0] : undefined;
        const epic = own?.epic ? state?.epics?.find((e) => e.id === own.epic) : undefined;
        // In its tab, the row of the focused pane's session; a tab's own row when it has no session.
        const here = row.tabId === activeTabId && !isPage(mainView) && (!own || own.blockId === focusedBlock || !listed.some((r) => r.tabId === row.tabId && r.sessions[0]?.blockId === focusedBlock));
        const props = {
            key: row.key,
            rowKey: row.key,
            rowNo: listed.indexOf(row) + 1,
            look: own ? (epic ? lookOf(epic) : NO_EPIC) : undefined,
            // By epic the rows lose the state bands that head them by state, so each says its own.
            band: byEpic ? row.band : undefined,
            tabId: row.tabId,
            v,
            active: here,
            cursor: switchTarget === row.key,
            renaming: !own && renaming === row.tabId,
            onOpen: () => (own ? focusSession(model!.targets[row.key] ?? { tabId: row.tabId, blockId: own.blockId }) : open(row.tabId)),
            onMenu: (e: React.MouseEvent) => menu(e, row.tabId),
            onClose: own ? undefined : () => closeProjectTab(row.tabId, true),
            onRename: (title: string | null) => {
                setRenaming(null);
                focusArea("terminal");
                if (title?.trim()) fireAndForget(() => setProjectTitle(row.tabId, title.trim(), true));
            },
        };
        return row.band === "quiet" ? <QuietRow {...props} /> : row.band === "running" ? <QuietRow {...props} v={{ ...v, reason: v.next }} dot={T.moss} /> : <CardRow {...props} />;
    };

    const bgCard = (s: Session) => (
        <CardRow key={`bg:${s.id}`} rowKey={`bg:${s.id}`} tabId={`bg:${s.id}`} v={{ title: sessionName(s), next: s.ask?.text ?? "it waits for you", tone: "apricot", age: relTime(Date.now() - s.since), meta: "background · ⏎ or a click opens it in a pane" }} active={false} cursor={switchTarget === `bg:${s.id}`} renaming={false} onOpen={() => openBackground(s.bgId!)} onMenu={(e) => e.preventDefault()} onRename={() => {}} />
    );
    const wakeCard = (w: ClosedWake) => (
        <CardRow key={`wake:${w.sessionId}`} rowKey={`wake:${w.projectId}`} tabId={`wake:${w.projectId}`} v={{ title: w.title, next: w.line, tone: w.news ? "blue" : "apricot", age: relTime(Date.now() - w.due), meta: "closed · ⌃⇥ or ⌘J/⌘K opens it" }} active={false} cursor={switchTarget === `wake:${w.projectId}`} renaming={false} onOpen={() => reopenWoke(w)} onMenu={(e) => e.preventDefault()} onRename={() => {}} />
    );

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
                {state && (
                    <div style={{ display: "grid", gridTemplateColumns: `repeat(${2 + Math.max(1, panels.length + loading.length)}, minmax(0, 1fr))`, gap: 6 }}>
                        <Tile label="Epics" keys="⇧⌘Y" value={String(openEpics)} note={epicsWaiting ? `${epicsWaiting} waiting` : undefined} active={mainView === "day" || mainView === "reflect" || mainView === "epic"} cursor={switchTarget === "card:today"} onClick={() => openView("day")} />
                        <Tile label="PRs" keys="⇧⌘G" value={queue ? String(queue.yours) : "…"} note={queue && queue.pastSla ? `${queue.pastSla} late` : undefined} sub={queue?.team ? `${queue.team} team` : undefined} busy={running.has("gh-prs")} active={shows("prs")} cursor={switchTarget === "card:prs"} onClick={() => goToInbox("prs")} />
                        {panels.map((p) => <Tile key={p.name} label={p.title} keys="⇧⌘O" value={cardValue(p.counts).map((c) => c.value).join(" · ")} broken={!!p.error || p.counts.some((x) => x.count == null)} busy={running.has(p.name)} active={shows("oncall")} cursor={switchTarget === "card:oncall"} onClick={() => goToInbox("oncall")} />)}
                        {loading.map((p) => <Tile key={p.name} label={p.title} keys="⇧⌘O" value="…" active={shows("oncall")} cursor={switchTarget === "card:oncall"} onClick={() => goToInbox("oncall")} />)}
                    </div>
                )}
                {state && (
                    <button type="button" data-wintos="sidebar-view" data-key="⌥⌘V" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => runKey("sidebar-view")} style={{ alignSelf: "flex-start", margin: "-8px 4px -6px", padding: 0, background: "transparent", border: "none", cursor: "pointer", fontFamily: T.ui, fontSize: 11.5, color: T.faint }}>
                        {byEpic ? "by epic · show by state" : "by state · show by epic"}
                    </button>
                )}
                {state && !byEpic && <PinnedEpics epics={pinned} sessions={state.sessions.filter((x) => x.state !== "ended" && !x.background)} now={now} cursor={switchTarget} />}
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
                        <Band kind="needs" count={(byEpic ? 0 : model.needs.length) + wakeNeeds.length + bgNeeds.length}>
                            {bgNeeds.map(bgCard)}
                            {wakeNeeds.map(wakeCard)}
                            {!byEpic && model.needs.map(renderRow)}
                        </Band>
                        {byEpic ? (
                            <>
                                <Band kind="read" count={wakeNews.length}>{wakeNews.map(wakeCard)}</Band>
                                <EpicGroups groups={groups} renderRow={renderRow} cursor={switchTarget} newStep={(epic) => (globalStore.set(newStepEpicAtom, epic), runKey("new-step"))} background={background} />
                            </>
                        ) : (
                        <>
                        <Band kind="read" count={model.read.length + wakeNews.length}>
                            {wakeNews.map(wakeCard)}
                            {model.read.map(renderRow)}
                        </Band>
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
                                    <span>{showAll ? "Fold the quiet ones" : `${allQuiet.length - quiet.length} quiet`}</span>
                                    <Key k="⌥⌘S" label="" />
                                </button>
                            ) : null}
                        </Band>
                        </>
                        )}
                    </>
                )}
            </div>
            {state && <RhythmMeter state={state} />}
        </div>
    );
});
WintOSSidebar.displayName = "WintOSSidebar";

// The sidebar's foot: the sessions in flight, green at work, apricot waiting on you, and how
// long since your last break.
function RhythmMeter({ state }: { state: WintosState }) {
    const now = useNow(60_000);
    const n = inFlight(state.sessions, now);
    const total = n.working + n.waiting;
    const r = state.rhythm;
    const marks = Array.from({ length: Math.min(12, total) }, (_, i) => (i < n.working ? T.moss : T.apricot));
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
            {rest && <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.faint }}>{rest}</span>}
        </div>
    );
}

// The day as a tile: how much of the plan is done, or that it still needs one.

// A small tile at the top of the sidebar: Today, PRs, On call. hot: it needs you (an unplanned
// day); note: what is late, in brick; broken: its last run could not fetch everything.
function Tile({ label, keys, value, note, sub, hot, broken, busy, active, cursor, onClick }: { label: string; keys: string; value: string; note?: string; sub?: string; hot?: boolean; broken?: boolean; busy?: boolean; active?: boolean; cursor?: boolean; onClick: () => void }) {
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
            {sub && <span style={{ fontSize: 11.5, color: T.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</span>}
        </div>
    );
}

function Band({ kind, count, shown, children }: { kind: keyof typeof BAND_STYLE; count: number; shown?: number; children: React.ReactNode }) {
    if (!count) return null;
    const s = BAND_STYLE[kind];
    return (
        <div data-band-group={kind} style={{ display: "flex", flexDirection: "column", gap: kind === "quiet" ? 3 : 7 }}>
            <span style={{ padding: "0 4px", fontSize: 12, fontWeight: 600, letterSpacing: "0.03em", color: kind === "quiet" ? T.faint : kind === "running" ? T.quietTitle : s.color }}>
                {s.label} · {shown !== undefined && shown < count ? `${shown} of ${count}` : count}
            </span>
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
    onClose?: () => void;
    look?: Look;
    rowKey: string;
    rowNo?: number;
    band?: Row["band"];
};

const StateChip = ({ band }: { band?: Row["band"] }) =>
    band ? <span data-wintos="row-state" data-state={band} style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 600, letterSpacing: "0.03em", color: BAND_STYLE[band].color }}>{BAND_STYLE[band].label}</span> : null;

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
    <span className="w-hold" style={{ display: "inline-flex", alignItems: "center", height: 0, gap: 8 }}>
        <Key k="⌘K" label="↑" hold />
        <Key k="⌘J" label="↓" hold />
    </span>
);

// A project's ×, shown on the row pointed at (and the open one); it closes like the menu's Close tab.
const RowClose = ({ p }: { p: RowProps }) =>
    p.onClose ? (
        <button type="button" className="w-hover-x" aria-label="Close this project" title={p.active ? "Close this project (⇧⌘W)" : "Close this project"} data-key={p.active ? "⇧⌘W" : ""} tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={(e) => (e.stopPropagation(), p.onClose!())} style={{ flexShrink: 0, width: 18, height: 18, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", borderRadius: 5, color: T.muted, cursor: "pointer" }}>
            <i className="fa-solid fa-xmark" style={{ fontSize: 10.5 }} />
        </button>
    ) : null;

function CardRow(p: RowProps) {
    const { v } = p;
    const tone = { apricot: T.apricot, blue: T.blue, brick: T.brick, secondary: T.secondary }[v.tone ?? "secondary"];
    return (
        <div
            data-tabid={p.tabId}
            data-row={p.rowKey}
            data-band="card"
            className="w-row"
            data-on={p.active || undefined}
            data-key={p.rowNo && p.rowNo <= 9 ? `⌥⌘${p.rowNo}` : "⌘J / ⌘K"}
            data-nobadge
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
                {p.look && <EpicAvatar look={p.look} size={22} />}
                <Title v={v} renaming={p.renaming} onRename={p.onRename} style={{ flexGrow: 1, minWidth: 0, fontSize: 14, fontWeight: 600, letterSpacing: "-0.005em", color: p.active ? T.emphasis : T.title, fontFamily: T.ui }} />
                <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    {p.active && <WalkKeys />}
                    <StateChip band={p.band} />
                    <span style={{ fontFamily: T.mono, fontSize: 11, color: T.muted }}>{v.age}</span>
                    <RowClose p={p} />
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
            data-row={p.rowKey}
            data-band="quiet"
            className="w-row"
            data-on={p.active || undefined}
            data-key={p.rowNo && p.rowNo <= 9 ? `⌥⌘${p.rowNo}` : "⌘J / ⌘K"}
            data-nobadge
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
            {p.look && <EpicAvatar look={p.look} size={18} />}
            {p.dot && <span style={{ width: 6, height: 6, borderRadius: "50%", background: p.dot, flexShrink: 0, marginRight: -2 }} />}
            <Title v={v} renaming={p.renaming} onRename={p.onRename} style={{ flexGrow: 1, minWidth: 0, fontSize: 13, color: p.active ? T.emphasis : T.quietTitle, fontFamily: T.ui, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} />
            {v.view && <span data-wintos="row-view" title="shares its view with the other sessions marked so" style={{ flexShrink: 0, fontFamily: T.mono, fontSize: 10.5, color: T.faint }}>⧉</span>}
            {p.active && <WalkKeys />}
            <StateChip band={p.band} />
            <span title={v.reason} style={{ maxWidth: "48%", fontSize: 11.5, color: v.tone === "brick" ? T.brick : T.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.tone === "brick" ? "note unreadable" : v.reason}</span>
            <RowClose p={p} />
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
