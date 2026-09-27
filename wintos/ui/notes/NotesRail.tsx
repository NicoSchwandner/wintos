import { useAtom, useSetAtom } from "jotai";
import { memo } from "react";
import { Key } from "../Key";
import { T } from "../tokens";
import { Mine } from "./Mine";
import { ProjectNotes } from "./ProjectNotes";
import { editingMineAtom } from "./state";
import { useNotes } from "./useNotes";

// The notes rail beside the terminal (MainC): next action, project.md, mine.md.
export const NotesRail = memo(({ tabId }: { tabId: string }) => {
    const { notes, project, save } = useNotes(tabId);
    const [editing] = useAtom(editingMineAtom);
    const setEditing = useSetAtom(editingMineAtom);
    return (
        <div
            data-wintos="notes-rail"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === "e" && !editing && notes) (e.preventDefault(), setEditing(true));
            }}
            style={{ width: 352, flexShrink: 0, boxSizing: "border-box", padding: "12px 22px", display: "flex", flexDirection: "column", gap: 14, overflowY: "auto", outline: "none", fontFamily: T.ui, borderLeft: `1px solid ${T.hairline}` }}
        >
            {project?.next && (
                <div style={{ padding: "12px 14px", background: "#241C15", border: "1px solid #6B4F36", borderRadius: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", color: T.apricot }}>Next action</span>
                    <span style={{ fontSize: 12.5, lineHeight: 1.55, color: "#EBDCCB" }}>{project.next}</span>
                </div>
            )}
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
            <div style={{ padding: "12px 14px", background: "#1A1716", border: `1px solid ${editing ? T.borderActive : T.keycapBorder}`, borderRadius: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontFamily: T.mono, fontSize: 11, color: T.title }}>mine.md</span>
                    <Key k={editing ? "⌘⏎" : "e"} label={editing ? "save · esc discard" : "edit"} />
                </div>
                <Mine text={notes?.mine ?? ""} mtime={notes?.mineMtime ?? 0} canEdit={!!notes} save={save} size="rail" />
            </div>
        </div>
    );
});
NotesRail.displayName = "NotesRail";
