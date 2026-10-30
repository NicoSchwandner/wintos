import { memo, useEffect, useState } from "react";
import { Key } from "./Key";
import { T } from "./tokens";
import { readUndo, UNDO_EVENT } from "./undo";

const SHOWN_MS = 4000;

// What ⌘Z would bring back, for a few seconds after it was put away, in whichever tab you are now.
export const UndoToast = memo(() => {
    const [label, setLabel] = useState<string | null>(null);
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const sync = () => {
            const last = readUndo()[0];
            const left = last ? SHOWN_MS - (Date.now() - last.at) : 0;
            clearTimeout(timer);
            setLabel(left > 0 ? last.label : null);
            if (left > 0) timer = setTimeout(() => setLabel(null), left);
        };
        sync();
        window.addEventListener(UNDO_EVENT, sync);
        window.addEventListener("storage", sync);
        return () => (clearTimeout(timer), window.removeEventListener(UNDO_EVENT, sync), window.removeEventListener("storage", sync));
    }, []);
    if (!label) return null;
    return (
        <div
            data-wintos="undo-toast"
            style={{ position: "absolute", bottom: 18, left: "50%", transform: "translateX(-50%)", zIndex: 90, maxWidth: "calc(100% - 32px)", padding: "8px 14px", background: T.ground, border: `1px solid ${T.borderActive}`, borderRadius: 10, fontFamily: T.ui, fontSize: 12.5, color: T.secondary, display: "flex", alignItems: "center", gap: 14, pointerEvents: "none" }}
        >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
            <Key k="⌘Z" label="undo" />
        </div>
    );
});
UndoToast.displayName = "UndoToast";
