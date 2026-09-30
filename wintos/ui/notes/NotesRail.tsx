import { useAtomValue } from "jotai";
import { memo, useEffect, useRef } from "react";
import { useZoneKeys } from "../zones";
import { railCollapsedAtom, setRailCollapsed, syncRailCollapsed, useRailWidth } from "./railWidth";
import { Key } from "../Key";
import { T } from "../tokens";
import { Mine } from "./Mine";
import { ProjectNotes } from "./ProjectNotes";
import { editingMineAtom } from "./state";
import { useNotes } from "./useNotes";
import { notesKeys, PrList } from "./PrList";
import { useWintos } from "../useWintos";

// The notes rail beside the terminal (MainC): next action, project.md, mine.md.
export const NotesRail = memo(({ tabId }: { tabId: string }) => {
    const { notes, project, save } = useNotes(tabId);
    const editing = useAtomValue(editingMineAtom);
    const { state } = useWintos();
    const ref = useRef<HTMLDivElement>(null);
    useZoneKeys(ref, notesKeys(tabId, state, !editing && !!notes));
    const [width, setWidth, saveWidth] = useRailWidth();
    const collapsed = useAtomValue(railCollapsedAtom);
    useEffect(() => (window.addEventListener("storage", syncRailCollapsed), () => window.removeEventListener("storage", syncRailCollapsed)), []);
    const drag = (e: React.PointerEvent<HTMLDivElement>) => {
        const handle = e.currentTarget;
        const right = handle.getBoundingClientRect().right + width; // the rail's right edge stays put
        handle.setPointerCapture(e.pointerId);
        handle.onpointermove = (m) => setWidth(right - m.clientX);
        handle.onpointerup = () => ((handle.onpointermove = handle.onpointerup = null), saveWidth());
    };
    if (collapsed)
        return (
            <div onClick={() => setRailCollapsed(false)} title="Show the notes (⌘L)" style={{ width: 20, flexShrink: 0, cursor: "pointer", borderLeft: `1px solid ${T.hairline}`, display: "flex", justifyContent: "center", paddingTop: 12, color: T.faint, fontSize: 13 }}>
                ‹
            </div>
        );
    return (
        <>
        {/* The rail's left edge: drag to resize, as the sidebar's right edge; › at its top folds it away. */}
        <div onPointerDown={drag} style={{ width: 9, flexShrink: 0, cursor: "col-resize", borderLeft: `1px solid ${T.hairline}`, display: "flex", justifyContent: "center" }}>
            <span onPointerDown={(e) => e.stopPropagation()} onClick={() => setRailCollapsed(true)} title="Hide the notes" style={{ marginTop: 10, cursor: "pointer", color: T.faint, fontSize: 13, lineHeight: 1 }}>
                ›
            </span>
        </div>
        <div
            data-wintos="notes-rail"
            tabIndex={0}
            data-zone="list"
            ref={ref}
            style={{ width, flexShrink: 0, boxSizing: "border-box", padding: "12px 22px 12px 17px", display: "flex", flexDirection: "column", gap: 14, overflowY: "auto", overflowX: "hidden", outline: "none", fontFamily: T.ui }}
        >
            {project?.next && (
                <div style={{ padding: "10px 12px", background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, display: "flex", flexDirection: "column", gap: 5 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", color: T.muted }}>Next action</span>
                    <span style={{ fontSize: 12.5, lineHeight: 1.55, color: T.secondary }}>{project.next}</span>
                </div>
            )}
            <PrList tabId={tabId} size="rail" />
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontFamily: T.mono, fontSize: 11, color: T.secondary }}>project.md</span>
                    <span style={{ fontSize: 10, color: T.faint }}>written by the sessions</span>
                </div>
                {!notes ? (
                    <span style={{ fontSize: 12.5, color: T.faint }}>No notes yet. They start once Claude names the project.</span>
                ) : notes.projectMd === null ? (
                    <span style={{ fontSize: 12.5, color: T.brick }}>project.md is unreadable. The next prompt asks Claude to repair it.</span>
                ) : (
                    <ProjectNotes md={notes.projectMd} size="rail" />
                )}
            </div>
            <div style={{ padding: "12px 14px", background: "#282828", border: `1px solid ${editing ? T.borderActive : T.keycapBorder}`, borderRadius: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontFamily: T.mono, fontSize: 11, color: T.title }}>mine.md</span>
                    <Key k={editing ? "⌘⏎" : "⌘E"} label={editing ? "save · esc discard" : "edit"} />
                </div>
                <Mine text={notes?.mine ?? ""} mtime={notes?.mineMtime ?? 0} canEdit={!!notes} save={save} size="rail" />
            </div>
        </div>
        </>
    );
});
NotesRail.displayName = "NotesRail";
