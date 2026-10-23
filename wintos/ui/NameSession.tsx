import { memo, useState } from "react";
import { closeOverlay, focusedSession } from "./focus";
import { Key } from "./Key";
import { T } from "./tokens";
import { useFocusOnMount } from "./useFocusOnMount";
import { daemonFetch } from "./useWintos";
import { sessionName } from "./view";

// ⌥⌘N: the focused session's name. Yours sticks; a name the session suggests since then is in
// the field already, so ⏎ takes it.
export const NameSession = memo(() => {
    const ref = useFocusOnMount<HTMLInputElement>();
    const [session] = useState(focusedSession);
    const [text, setText] = useState(() => (session ? (session.name?.suggested ?? sessionName(session)) : ""));
    if (!session) return null;
    const save = () => {
        const t = text.trim();
        if (t) {
            const accept = t === session.name?.suggested;
            void daemonFetch(`/sessions/${encodeURIComponent(session.id)}/name${accept ? "/accept" : ""}`, { method: "POST", body: accept ? {} : { text: t } });
        }
        closeOverlay();
    };
    return (
        <div style={{ position: "absolute", inset: 0, zIndex: 100, background: "rgba(15,16,17,0.6)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "18vh" }} onClick={closeOverlay}>
            <div data-wintos="name-session" data-zone="overlay" onClick={(e) => e.stopPropagation()} style={{ width: "min(520px, calc(100% - 32px))", padding: "18px 22px", background: "#1d2021", border: `1px solid ${T.borderActive}`, borderRadius: 12, fontFamily: T.ui, display: "flex", flexDirection: "column", gap: 12 }}>
                <span style={{ fontFamily: T.display, fontSize: 22, color: T.emphasis }}>Name this session</span>
                {session.name?.suggested && <span style={{ fontSize: 12, color: T.muted }}>It suggests “{session.name.suggested}”; ⏎ takes it.</span>}
                <input
                    ref={ref}
                    value={text}
                    maxLength={60}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") e.preventDefault(), save();
                        if (e.key === "Escape") e.preventDefault(), e.stopPropagation(), closeOverlay();
                    }}
                    style={{ padding: "7px 10px", background: T.card, border: `1px solid ${T.borderActive}`, borderRadius: 8, outline: "none", color: T.text, fontFamily: T.ui, fontSize: 14 }}
                />
                <div style={{ display: "flex", gap: 22, fontSize: 12, color: T.muted }}>
                    <Key k="⏎" label="name it: yours stays" />
                    <Key k="esc" label="keep it as it is" />
                </div>
            </div>
        </div>
    );
});
NameSession.displayName = "NameSession";
