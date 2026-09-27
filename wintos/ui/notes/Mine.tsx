import { useAtom } from "jotai";
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
    const [editing, setEditing] = useAtom(editingMineAtom);
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
                        if (e.key === "Escape") setEditing(false);
                        if (e.key === "Enter" && e.metaKey) {
                            e.preventDefault();
                            const r = await save(draft, base);
                            if (r === "ok") setEditing(false);
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
    const paragraphs = text
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean);
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: size === "rail" ? 8 : 14 }}>
            {paragraphs.length === 0 && (
                <span style={{ fontSize: 12.5, color: T.faint }}>
                    {canEdit
                        ? "Empty. Press e to write what the sessions must respect."
                        : "Available once the project has a title."}
                </span>
            )}
            {paragraphs.map((p, i) =>
                p.split("\n").map((line, j) => (
                    <span
                        key={`${i}-${j}`}
                        style={{
                            fontFamily: size === "full" ? T.mono : T.ui,
                            fontSize: 12.5,
                            lineHeight: 1.6,
                            color: /^#+ /.test(line) ? T.apricot : T.secondary,
                        }}
                    >
                        {line}
                    </span>
                ))
            )}
        </div>
    );
}
