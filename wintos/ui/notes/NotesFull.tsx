import { useFocusOnMount } from "../useFocusOnMount";
import { useZoneKeys } from "../zones";
import { useAtomValue } from "jotai";
import { memo } from "react";
import { T } from "../tokens";
import { Mine } from "./Mine";
import { Key } from "../Key";
import { ProjectNotes } from "./ProjectNotes";
import { editingMineAtom } from "./state";
import { useNotes } from "./useNotes";
import { notesKeys, PrList } from "./PrList";
import { useWintos } from "../useWintos";

// ⇧⌘J: both files full width, side by side (NotesC).
export const NotesFull = memo(({ tabId }: { tabId: string }) => {
    const focusRef = useFocusOnMount<HTMLDivElement>();
    const { notes, project, save } = useNotes(tabId);
    const editing = useAtomValue(editingMineAtom);
    const { state } = useWintos();
    useZoneKeys(focusRef, notesKeys(tabId, state, !editing && !!notes));
    return (
        <div
            data-wintos="notes-full"
            tabIndex={0}
            ref={focusRef}
            data-zone="list"
            style={{ flexGrow: 1, display: "flex", flexDirection: "column", background: "#1d2021", outline: "none", fontFamily: T.ui, minWidth: 0 }}
        >
            <div style={{ padding: "18px 26px 16px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    <h1 style={{ margin: 0, fontFamily: T.display, fontSize: 30, fontWeight: 400, lineHeight: 1, color: T.emphasis }}>{project?.title ?? "Untitled"}</h1>
                    <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.muted }}>{notes?.dir ?? "no project folder yet"}</span>
                </div>
                <Key k="esc" label="back to the terminal" />
            </div>
            <div style={{ flexGrow: 1, padding: "0 26px 20px", display: "flex", gap: 20, overflow: "hidden" }}>
                <div style={{ flexGrow: 1, flexBasis: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                    <Header name="project.md" note="the sessions write this · rendered, not editable here" />
                    <div style={{ paddingTop: 18, overflowY: "auto", display: "flex", flexDirection: "column", gap: 18 }}>
                        <PrList tabId={tabId} size="full" />
                        {notes?.projectMd == null ? (
                            <span style={{ fontSize: 13.5, color: notes ? T.brick : T.faint }}>{notes ? "project.md is unreadable. The next prompt asks Claude to repair it." : "No notes yet."}</span>
                        ) : (
                            <ProjectNotes md={notes.projectMd} size="full" />
                        )}
                    </div>
                </div>
                <div style={{ width: 382, flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                    <Header name="mine.md" note={editing ? "yours · editing" : "yours"} />
                    <div style={{ flexGrow: 1, marginTop: 18, display: "flex", flexDirection: "column", overflowY: "auto", ...(editing ? {} : { padding: "16px 18px", background: T.terminal, border: `1px solid ${T.border}`, borderRadius: 10 }) }}>
                        <Mine text={notes?.mine ?? ""} mtime={notes?.mineMtime ?? 0} canEdit={!!notes} save={save} size="full" />
                    </div>
                    <div style={{ paddingTop: 10, display: "flex", gap: 12 }}>
                        {editing ? (
                            <>
                                <Key k="⌘⏎" label="save" />
                                <Key k="esc" label="discard" />
                            </>
                        ) : (
                            <Key k="⌘E" label="edit mine.md" />
                        )}
                    </div>
                    <div style={{ marginTop: 14, padding: "11px 13px", background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, fontSize: 11.5, lineHeight: 1.6, color: T.muted }}>
                        The sessions read this file on every prompt and never write to it. What you put here outranks anything they concluded.
                    </div>
                </div>
            </div>
        </div>
    );
});
NotesFull.displayName = "NotesFull";

function Header({ name, note }: { name: string; note: string }) {
    return (
        <div style={{ flexShrink: 0, display: "flex", alignItems: "baseline", justifyContent: "space-between", paddingBottom: 12, borderBottom: `1px solid ${T.hairline}` }}>
            <span style={{ fontFamily: T.mono, fontSize: 12, color: T.title }}>{name}</span>
            <span style={{ fontSize: 11, color: T.faint }}>{note}</span>
        </div>
    );
}
