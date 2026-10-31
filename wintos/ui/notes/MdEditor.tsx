import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { T } from "../tokens";
import { useZoneKeys } from "../zones";
import { fitHeight, revealCaret } from "./caret";
import { continueList, indentLines, toggleBox } from "./listEdit";
import type { SaveResult } from "./useNotes";

// The one editor for markdown you write in WintOS: mine.md, today's focus, the reflection, the
// daily. ⏎ ⇥ ⌘L edit lists, ⌘⏎ saves, esc discards (a second esc when there are changes).
// file names it in errors; id is its data-wintos, what focus and tests find it by.
export function MdEditor({ initial, save, close, file, size, id }: { initial: string; save: (text: string) => Promise<SaveResult>; close: () => void; file: string; size: "rail" | "full"; id: string }) {
    const [draft, setDraft] = useState(initial);
    const [error, setError] = useState<string | null>(null);
    const [warned, setWarned] = useState(false);
    const ref = useRef<HTMLTextAreaElement>(null);
    useEffect(() => void setTimeout(() => ref.current?.focus(), 0), []);
    useLayoutEffect(() => {
        if (!ref.current) return;
        fitHeight(ref.current, size === "rail" ? 160 : 260);
        if (document.activeElement === ref.current) revealCaret(ref.current);
    }, [draft]);
    useZoneKeys(ref, {
        Escape: () => (draft === initial || warned ? close() : setWarned(true)),
        "Cmd:Enter": () =>
            void save(draft).then((r) => {
                if (r === "ok") close();
                else if (r === "conflict") setError(`${file} changed on disk while you edited. Copy your text, press esc and edit again.`);
                else setError("could not save: wintosd refused or is offline");
            }),
    });
    return (
        <>
            {error && <span style={{ color: T.brick, fontSize: 11 }}>{error}</span>}
            {warned && <span style={{ color: T.apricot, fontSize: 11 }}>Unsaved changes · esc again to discard, ⌘⏎ to save</span>}
            <textarea
                ref={ref}
                value={draft}
                onChange={(e) => (setDraft(e.target.value), setWarned(false))}
                onKeyDown={(e) => listKeys(e, setDraft)}
                onSelect={(e) => revealCaret(e.currentTarget)}
                data-zone="overlay"
                data-wintos={id}
                spellCheck={false}
                style={{
                    flexShrink: 0,
                    resize: "none",
                    overflow: "hidden",
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
