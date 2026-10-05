import { useAtomValue } from "jotai";
import { editMine } from "../focus";
import { toggleCheckbox } from "./checkbox";
import { continueList, indentLines, toggleBox } from "./listEdit";
import { Md } from "./Md";
import { useEffect, useRef, useState } from "react";
import { T } from "../tokens";
import { editingMineAtom } from "./state";
import type { SaveResult } from "./useNotes";
import { useZoneKeys } from "../zones";

// mine.md: rendered as paragraphs, edited in place. ⌘⏎ saves, esc discards. The Today page edits
// the day's focus with it too: file names it in errors, empty says what to write.
export function Mine({
    text,
    mtime,
    canEdit,
    save,
    size,
    file = "mine.md",
    empty = "Empty. Press ⌘E to write what the sessions must respect.",
    start = "",
}: {
    text: string;
    mtime: number;
    canEdit: boolean;
    save: (t: string, baseMtime: number) => Promise<SaveResult>;
    size: "rail" | "full";
    file?: string;
    empty?: string;
    start?: string; // what an edit of an empty file begins with (the Today page: yesterday's leftovers)
}) {
    const editing = useAtomValue(editingMineAtom);
    const [draft, setDraft] = useState(text);
    const [error, setError] = useState<string | null>(null);
    // The version the edit started from; a save against anything newer is refused.
    const [base, setBase] = useState(mtime);
    const ref = useRef<HTMLTextAreaElement>(null);
    // What the edit started with, and whether Esc already warned that it would throw changes away.
    const [initial, setInitial] = useState("");
    const [warned, setWarned] = useState(false);
    useEffect(() => {
        const first = text.trim() ? text : start;
        if (editing) (setDraft(first), setInitial(first), setWarned(false), setBase(mtime), setError(null), setTimeout(() => ref.current?.focus(), 0));
    }, [editing]);

    useZoneKeys(ref, {
        // Esc with unsaved changes warns first; a second Esc discards them.
        Escape: () => (draft === initial || warned ? editMine(false) : setWarned(true)),
        "Cmd:Enter": () =>
            void save(draft, base).then((r) => {
                if (r === "ok") editMine(false);
                else if (r === "conflict") setError(`${file} changed on disk while you edited. Copy your text, press esc and edit again.`);
                else setError("could not save: wintosd refused or is offline");
            }),
    });

    if (editing && canEdit) {
        return (
            <>
                {error && <span style={{ color: T.brick, fontSize: 11 }}>{error}</span>}
                {warned && <span style={{ color: T.apricot, fontSize: 11 }}>Unsaved changes · esc again to discard, ⌘⏎ to save</span>}
                <textarea
                    ref={ref}
                    value={draft}
                    onChange={(e) => (setDraft(e.target.value), setWarned(false))}
                    onKeyDown={(e) => listKeys(e, setDraft)}
                    data-zone="overlay"
                    data-wintos="mine-editor"
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
    // A task box ticks in place: its line of the file flips and is saved like an edit, refused if
    // mine.md changed on disk meanwhile.
    const tick = async (i: number) => {
        const r = await save(toggleCheckbox(text, i), mtime);
        setError(r === "ok" ? null : r === "conflict" ? `${file} changed on disk; it reloads, then tick again.` : "could not save: wintosd refused or is offline");
    };
    return (
        <div data-wintos={canEdit ? "mine-editable" : undefined} style={{ display: "flex", flexDirection: "column", gap: size === "rail" ? 4 : 6 }}>
            {error && <span style={{ color: T.brick, fontSize: 11 }}>{error}</span>}
            {!text.trim() && (
                <span style={{ fontSize: 12.5, color: T.faint }}>
                    {canEdit ? empty : "Available once the project has a title."}
                </span>
            )}
            {text.trim() && <Md text={text} size={size} onTick={canEdit ? (i) => void tick(i) : undefined} />}
        </div>
    );
}

// ⏎ continues a list, Tab / ⇧Tab indent it, ⌘L ticks the line's box (listEdit.ts). Outside a
// list the field does its default, except Tab, which indents rather than leaving the field.
function listKeys(e: React.KeyboardEvent<HTMLTextAreaElement>, setDraft: (t: string) => void): void {
    const t = e.currentTarget;
    // As typed, not set: only the field's own editing scrolls the caret into view and keeps ⌘Z.
    const put = (text: string, start: number, end = start) => {
        e.preventDefault();
        const old = t.value;
        let a = 0;
        while (a < old.length && a < text.length && old[a] === text[a]) a++;
        let b = 0;
        while (b < old.length - a && b < text.length - a && old[old.length - 1 - b] === text[text.length - 1 - b]) b++;
        t.setSelectionRange(a, old.length - b);
        const middle = text.slice(a, text.length - b);
        if (!document.execCommand(middle ? "insertText" : "delete", false, middle)) setDraft(text);
        t.setSelectionRange(start, end);
    };
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
    if (e.key === "Enter" && plain && !e.shiftKey) {
        const r = continueList(t.value, t.selectionStart);
        if (r) put(r.text, r.caret);
    } else if (e.key === "Tab" && plain) {
        const r = indentLines(t.value, t.selectionStart, t.selectionEnd, e.shiftKey);
        if (r) put(r.text, r.start, r.end);
        else if (!e.shiftKey) put(t.value.slice(0, t.selectionStart) + "  " + t.value.slice(t.selectionEnd), t.selectionStart + 2);
        else e.preventDefault();
    } else if (e.key === "l" && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        const r = toggleBox(t.value, t.selectionStart);
        if (r) put(r.text, r.caret);
    }
}
