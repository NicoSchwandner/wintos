import { useAtomValue } from "jotai";
import { editMine } from "../focus";
import { checkbox, toggleCheckbox } from "./checkbox";
import { Box } from "./ProjectNotes";
import { useEffect, useRef, useState } from "react";
import { T } from "../tokens";
import { editingMineAtom } from "./state";
import type { SaveResult } from "./useNotes";

// mine.md: rendered as paragraphs, edited in place. ⌘⏎ saves, esc discards.
export function Mine({
    text,
    mtime,
    canEdit,
    save,
    size,
}: {
    text: string;
    mtime: number;
    canEdit: boolean;
    save: (t: string, baseMtime: number) => Promise<SaveResult>;
    size: "rail" | "full";
}) {
    const editing = useAtomValue(editingMineAtom);
    const [draft, setDraft] = useState(text);
    const [error, setError] = useState<string | null>(null);
    // The version the edit started from; a save against anything newer is refused.
    const [base, setBase] = useState(mtime);
    const ref = useRef<HTMLTextAreaElement>(null);
    useEffect(() => {
        if (editing) (setDraft(text), setBase(mtime), setError(null), setTimeout(() => ref.current?.focus(), 0));
    }, [editing]);

    if (editing && canEdit) {
        return (
            <>
                {error && <span style={{ color: T.brick, fontSize: 11 }}>{error}</span>}
                <textarea
                    ref={ref}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={async (e) => {
                        e.stopPropagation();
                        if (e.key === "Escape") editMine(false);
                        if (e.key === "Enter" && e.metaKey) {
                            e.preventDefault();
                            const r = await save(draft, base);
                            if (r === "ok") editMine(false);
                            else if (r === "conflict")
                                setError(
                                    "mine.md changed on disk while you edited. Copy your text, press esc and edit again."
                                );
                            else setError("could not save: wintosd refused or is offline");
                        }
                    }}
                    spellCheck={false}
                    style={{
                        flexGrow: 1,
                        minHeight: size === "rail" ? 160 : undefined,
                        resize: "none",
                        boxSizing: "border-box",
                        padding: "16px 18px",
                        background: T.terminal,
                        border: `1px solid ${error ? T.brick : T.borderActive}`,
                        borderRadius: 10,
                        outline: "none",
                        fontFamily: T.mono,
                        fontSize: 12.5,
                        lineHeight: 1.75,
                        color: T.secondary,
                        caretColor: T.apricot,
                    }}
                />
            </>
        );
    }
    // Line by line (a blank line is a gap), so a task line can be ticked in place: one line of the
    // file flips and is saved like an edit, refused if mine.md changed on disk meanwhile.
    const lines = text.split("\n");
    const tick = async (i: number) => {
        const r = await save(toggleCheckbox(text, i), mtime);
        setError(r === "ok" ? null : r === "conflict" ? "mine.md changed on disk; it reloads, then tick again." : "could not save: wintosd refused or is offline");
    };
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: size === "rail" ? 4 : 6 }}>
            {error && <span style={{ color: T.brick, fontSize: 11 }}>{error}</span>}
            {!text.trim() && (
                <span style={{ fontSize: 12.5, color: T.faint }}>
                    {canEdit ? "Empty. Press ⌘E to write what the sessions must respect." : "Available once the project has a title."}
                </span>
            )}
            {lines.map((line, i) => {
                if (!line.trim()) return i > 0 && lines[i - 1].trim() ? <span key={i} style={{ height: size === "rail" ? 4 : 8 }} /> : null;
                const cb = checkbox(line);
                const style = { fontFamily: size === "full" ? T.mono : T.ui, fontSize: 12.5, lineHeight: 1.6, color: /^#+ /.test(line) ? T.apricot : T.secondary };
                if (!cb) return <span key={i} style={style}>{line}</span>;
                return (
                    <span key={i} style={{ ...style, display: "flex", gap: 8, color: cb.state === "done" ? T.muted : T.secondary, textDecoration: cb.state === "done" ? "line-through" : undefined }}>
                        <Box state={cb.state} size={size} onToggle={canEdit ? () => void tick(i) : undefined} />
                        {cb.text}
                    </span>
                );
            })}
        </div>
    );
}
