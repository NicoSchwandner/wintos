import { useAtomValue } from "jotai";
import { memo, useEffect, useState } from "react";
import type { EpicTime } from "../daemon/epics/time";
import { EpicAvatar } from "./EpicAvatar";
import { lookOf, shortName } from "./epicLook";
import { editMine, focusSession } from "./focus";
import { Key } from "./Key";
import { cursorKeys, startCursor } from "./itemCursor";
import { Mine } from "./notes/Mine";
import { openEpicAtom } from "./notes/state";
import { useEpicMine } from "./notes/useNotes";
import { shownState } from "./sessions";
import { SESSION_DOT, T } from "./tokens";
import { Panel } from "./TodayPage";
import { useFocusOnMount } from "./useFocusOnMount";
import { useNow } from "./useNow";
import { daemonFetch, useWintos } from "./useWintos";
import { relTime, sessionName } from "./view";
import { useZoneKeys } from "./zones";

const spent = (ms: number) => (ms < 3_600_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3_600_000).toFixed(1).replace(/\.0$/, "")} h`);

// An epic's page, from its card on the epics home: its sessions (each a step; ⏎ goes to its
// pane), its roadmap (the units its sessions set with wintos unit), its mine.md (⌘E edits it) and its time this month.
// p pins it to the top of the sidebar, to keep it in sight; x marks the epic done, or open again: a done epic leaves the sidebar's picks and stays in the report.
export const EpicPage = memo(() => {
    const ref = useFocusOnMount<HTMLDivElement>();
    const { state } = useWintos();
    const now = useNow(30_000);
    const id = useAtomValue(openEpicAtom);
    const epic = state?.epics?.find((e) => e.id === id);
    const { mine, save } = useEpicMine(epic?.id);
    const [month, setMonth] = useState<EpicTime | undefined>();
    const sessions = (state?.sessions ?? []).filter((s) => s.epic === id && s.state !== "ended" && !s.background);
    const iso = new Date(now).toISOString().slice(0, 7);
    useEffect(() => {
        let live = true;
        daemonFetch(`/time/month?month=${iso}`)
            .then((r) => (r.ok ? r.json() : []))
            .then((r: EpicTime[]) => live && setMonth(r.find((x) => x.epic === id)), () => {});
        return () => void (live = false);
    }, [id, iso]);
    useEffect(() => {
        if (ref.current) requestAnimationFrame(() => ref.current && startCursor(ref.current, (el) => el.dataset.item === "link"));
    }, [id]);
    const toggleDone = () => epic && void daemonFetch(`/epics/${encodeURIComponent(epic.id)}/done`, { method: "POST", body: { done: !epic.done } });
    const togglePin = () => epic && void daemonFetch(`/epics/${encodeURIComponent(epic.id)}/pin`, { method: "POST", body: { pinned: !epic.pinned } });
    useZoneKeys(ref, { ...cursorKeys(() => ref.current), "Cmd:e": () => editMine(true), x: () => (toggleDone(), true), p: () => (togglePin(), true) });
    if (!epic) return <div ref={ref} tabIndex={0} data-zone="list" style={{ flexGrow: 1, padding: 26, color: T.muted, fontFamily: T.ui, outline: "none" }}>That epic is gone.</div>;
    const look = lookOf(epic);
    const roadmap = epic.steps;
    return (
        <div ref={ref} tabIndex={0} data-zone="list" data-wintos="epic-page" data-epic={epic.id} style={{ flexGrow: 1, display: "flex", flexDirection: "column", gap: 16, padding: "18px 26px 18px", background: T.ground, outline: "none", fontFamily: T.ui, minWidth: 0, minHeight: 0, overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 16px", borderRadius: 12, background: `linear-gradient(90deg, ${look.bg} 0%, transparent 70%)`, borderTop: `3px solid ${look.fg}` }}>
                <EpicAvatar look={look} size={56} />
                <div style={{ display: "flex", flexDirection: "column", gap: 4, flexGrow: 1, minWidth: 0 }}>
                    <h1 style={{ margin: 0, fontFamily: T.display, fontSize: 30, fontWeight: 400, lineHeight: 1.1, color: T.emphasis }}>{epic.title}</h1>
                    <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.muted }}>
                        {[epic.done ? `done ${epic.done}` : `${sessions.length} session${sessions.length === 1 ? "" : "s"} open`, month && month.ms >= 60_000 && `${spent(month.ms)} this month`, epic.lane && `${epic.lane} sessions land here`].filter(Boolean).join(" · ")}
                    </span>
                </div>
                <span style={{ display: "flex", gap: 14 }}>
                    <button type="button" data-wintos="epic-pin" data-key="p" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={togglePin} style={{ padding: 0, background: "transparent", border: "none", cursor: "pointer" }}>
                        <Key k="p" label={epic.pinned ? "unpin from the sidebar" : "pin to the sidebar"} />
                    </button>
                    <button type="button" data-wintos="epic-done" data-key="x" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={toggleDone} style={{ padding: 0, background: "transparent", border: "none", cursor: "pointer" }}>
                        <Key k="x" label={epic.done ? "open it again" : "epic done ✓"} />
                    </button>
                    <Key k="esc" label="back" />
                </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(260px, 360px)", gap: 20, alignItems: "start" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <Panel label="Roadmap" note={roadmap.length ? `${roadmap.filter((u) => u.state === "done").length} of ${roadmap.length} done` : "none yet: wintos unit in a session sets it"}>
                        <div data-wintos="epic-roadmap" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {roadmap.map((u) => (
                                <div key={u.name} data-unit={u.state} style={{ display: "flex", alignItems: "baseline", gap: 10, fontSize: 13.5, color: u.state === "current" ? T.emphasis : u.state === "done" ? T.faint : T.secondary, fontWeight: u.state === "current" ? 600 : 400 }}>
                                    <span style={{ width: 10, flexShrink: 0, fontFamily: T.mono, color: u.state === "todo" ? T.faint : T.moss }}>{u.state === "done" ? "✓" : u.state === "current" ? "▸" : "○"}</span>
                                    <span style={{ textDecoration: u.state === "done" ? "line-through" : undefined }}>{u.name}</span>
                                </div>
                            ))}
                        </div>
                    </Panel>
                    <Panel label="Sessions" note={`${shortName(epic)} · each a step`} keys={sessions.length > 0 && <Key k="j k · ⏎" label="its pane" />}>
                        {sessions.map((s) => {
                            const shown = shownState(s, now);
                            return (
                                <div key={s.id} data-item="link" data-session={s.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                    <button type="button" data-act tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => focusSession({ tabId: s.tabId, blockId: s.blockId })} style={{ display: "flex", alignItems: "center", gap: 10, flexGrow: 1, minWidth: 0, padding: "4px 6px", margin: "0 -6px", borderRadius: 6, background: "transparent", border: "none", cursor: "pointer", textAlign: "left", fontFamily: T.ui, fontSize: 13.5, color: T.text }}>
                                        <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: SESSION_DOT[shown] }} />
                                        <span style={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sessionName(s)}</span>
                                        <span style={{ fontFamily: T.mono, fontSize: 11.5, color: shown === "waiting" ? T.apricot : T.muted }}>{shown} {relTime(now - s.since)}</span>
                                    </button>
                                </div>
                            );
                        })}
                        {!sessions.length && <span style={{ fontSize: 12.5, color: T.faint }}>No session in it now. ⌘N starts the next step.</span>}
                    </Panel>
                </div>
                <Panel label="mine.md" note="every session in the epic reads it" keys={<Key k="⌘E" label="edit" />}>
                    <Mine text={mine?.text ?? ""} mtime={mine?.mtime ?? 0} canEdit={!!mine} save={save} size="full" draftKey={`epic-mine:${epic.id}`} file={`${shortName(epic)}'s mine.md`} empty="Empty. Press ⌘E to write what every session in this epic must respect." />
                </Panel>
            </div>
        </div>
    );
});
EpicPage.displayName = "EpicPage";
