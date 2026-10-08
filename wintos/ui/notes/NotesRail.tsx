import { useAtomValue } from "jotai";
import { memo, useEffect, useRef, useState } from "react";
import { useZoneKeys } from "../zones";
import { cursorKeys } from "../itemCursor";
import { toggleView } from "../menu";
import { railCollapsedAtom, setRailCollapsed, syncRailCollapsed, useRailWidth } from "./railWidth";
import { Key } from "../Key";
import { T } from "../tokens";
import { Mine } from "./Mine";
import { ProjectNotes, Rich } from "./ProjectNotes";
import { editingMineAtom } from "./state";
import { useNotes } from "./useNotes";
import { notesKeys, PrList } from "./PrList";
import { useWintos } from "../useWintos";
import { runKey } from "../menu";
import { openPalette } from "../Palette";
import { relTime } from "../view";

// The notes rail beside the terminal (MainC): next action, project.md, mine.md.
export const NotesRail = memo(({ tabId }: { tabId: string }) => {
    const { notes, project, save } = useNotes(tabId);
    const editing = useAtomValue(editingMineAtom);
    const { state } = useWintos();
    const ref = useRef<HTMLDivElement>(null);
    // ⏎ on the rail opens the notes full width (as ⇧⌘L).
    // ⏎ opens the link under the cursor; with none, the notes full width.
    const cursor = cursorKeys(() => ref.current);
    useZoneKeys(ref, { ...notesKeys(tabId, state, !editing && !!notes), ...cursor, Enter: (e) => cursor.Enter(e) !== false || (!editing && (toggleView("notes"), true)) });
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
    // Folded, the rail takes no room: a button floats over the terminals' right edge.
    if (collapsed)
        return (
            <div style={{ position: "relative", width: 0, flexShrink: 0 }}>
                <RailToggle open={false} />
            </div>
        );
    return (
        <>
        {/* The rail's left edge: drag to resize, as the sidebar's right edge; the button on it folds the rail away. */}
        <div onPointerDown={drag} style={{ position: "relative", width: 9, flexShrink: 0, cursor: "col-resize", borderLeft: `1px solid ${T.hairline}` }}>
            <RailToggle open />
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
                    <span style={{ fontSize: 12.5, lineHeight: 1.55, color: T.secondary }}><Rich text={project.next} size="rail" /></span>
                </div>
            )}
            <div style={{ padding: "12px 14px", background: "#282828", border: `1px solid ${editing ? T.borderActive : T.keycapBorder}`, borderRadius: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontFamily: T.mono, fontSize: 11, color: T.title }}>mine.md</span>
                    <Key k={editing ? "⌘⏎" : "⌘E"} label={editing ? "save · esc discard" : "edit"} />
                </div>
                <Mine text={notes?.mine ?? ""} mtime={notes?.mineMtime ?? 0} canEdit={!!notes} save={save} size="rail" />
            </div>
            <PrList tabId={tabId} size="rail" />
            <Shelf shelf={state?.shelf?.[tabId] ?? []} />
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
        </div>
        </>
    );
});
NotesRail.displayName = "NotesRail";

// This project's shelved sessions, newest first, each back as a pane with its key.
function Shelf({ shelf }: { shelf: { sessionId: string; label: string; at: number }[] }) {
    if (!shelf.length) return null;
    const row = (k: string, text: string, onClick: () => void, key: string) => (
        <button key={key} type="button" data-key={k} tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 9, padding: 0, background: "transparent", border: "none", cursor: "pointer", fontFamily: T.ui, fontSize: 12.5, lineHeight: 1.55, color: T.quietTitle, textAlign: "left" }}>
            <Key k={k} label="" />
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text}</span>
        </button>
    );
    return (
        <div data-wintos="shelf-dock" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", color: T.faint }}>Shelved</span>
            {shelf.slice(0, 9).map((s, i) => row(`⌥⌘${i + 1}`, `${s.label} · ${relTime(Date.now() - s.at)}`, () => runKey(`unshelve-${i + 1}`), s.sessionId))}
            {shelf.length > 9 && row("⇧⌘P", `${shelf.length - 9} more`, () => openPalette("shelved"), "more")}
        </div>
    );
}

// Fold or unfold the rail: a real button, 24px (WCAG 2.2 target size), named and stating whether
// the rail is open, sitting on the divider. It never takes focus (⌘L is the keyboard way).
function RailToggle({ open }: { open: boolean }) {
    const [hover, setHover] = useState(false);
    return (
        <button
            type="button"
            aria-label={open ? "Hide the notes" : "Show the notes"}
            aria-expanded={open}
            title={open ? "Hide the notes (⌥⌘L)" : "Show the notes (⌥⌘L)"}
            tabIndex={-1}
            onPointerDown={(e) => (e.stopPropagation(), e.preventDefault())}
            data-key="⌥⌘L"
            onClick={(e) => (e.stopPropagation(), setRailCollapsed(open))}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            // Open: on the divider. Folded: floating over the terminals, dimmed until pointed at.
            // no-drag: folded it floats over the pane strip, a window-drag region that would take the click.
            style={{ WebkitAppRegion: "no-drag", position: "absolute", top: 10, left: open ? -12 : -34, zIndex: 20, width: 24, height: 24, borderRadius: 12, border: `1px solid ${hover ? T.borderActive : T.border}`, background: T.ground, color: hover ? T.title : T.muted, opacity: open || hover ? 1 : 0.55, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0, boxShadow: open ? "none" : "0 2px 8px rgba(0,0,0,0.4)" } as React.CSSProperties}
        >
            <i className={`fa-solid ${open ? "fa-chevron-right" : "fa-chevron-left"}`} style={{ fontSize: 10 }} />
            {/* The key beside the button, on the terminals' side, as every WintOS button shows its key. */}
            <span style={{ position: "absolute", right: 30, pointerEvents: "none", opacity: open || hover ? 1 : 0.8 }}>
                <Key k="⌥⌘L" label="" />
            </span>
        </button>
    );
}
