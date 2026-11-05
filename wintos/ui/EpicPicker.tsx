import { memo, useState } from "react";
import { EpicAvatar } from "./EpicAvatar";
import { lookOf, NO_EPIC } from "./epicLook";
import { closeOverlay, focusedSession } from "./focus";
import { Key } from "./Key";
import { T } from "./tokens";
import { useFocusOnMount } from "./useFocusOnMount";
import { daemonFetch, useWintos } from "./useWintos";
import { sessionName } from "./view";

// ⌥⌘E: the epic the focused session is a step of. Typing narrows the list; ⏎ takes the one
// marked, or starts a new epic of that name when none matches. 1-9 pick, 0 takes it out of any.
export const EpicPicker = memo(() => {
    const ref = useFocusOnMount<HTMLInputElement>();
    const { state } = useWintos();
    const [session] = useState(focusedSession);
    const [text, setText] = useState("");
    const open = (state?.epics ?? []).filter((e) => !e.done);
    // The cursor starts on the epic it is in, so ⏎ straight away changes nothing.
    const [at, setAt] = useState(() => Math.max(0, open.findIndex((e) => e.id === session?.epic)));
    if (!session) return null;
    const q = text.trim().toLowerCase();
    const shown = q ? open.filter((e) => [e.title, e.short ?? "", e.id].some((n) => n.toLowerCase().includes(q))) : open;
    const assign = (epic: string | null) => {
        void daemonFetch(`/sessions/${encodeURIComponent(session.id)}/epic`, { method: "POST", body: { epic } });
        closeOverlay();
    };
    const create = async (title: string) => {
        const r = await daemonFetch("/epics", { method: "POST", body: { title } }).catch(() => undefined);
        const id = r?.ok ? await r.text() : undefined;
        if (id) assign(id);
        else closeOverlay();
    };
    const pick = () => (shown[at] ? assign(shown[at].id) : q ? void create(text.trim()) : closeOverlay());
    return (
        <div style={{ position: "absolute", inset: 0, zIndex: 100, background: `color-mix(in srgb, ${T.ground} 70%, transparent)`, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "16vh" }} onClick={closeOverlay}>
            <div data-wintos="epic-picker" data-zone="overlay" onClick={(e) => e.stopPropagation()} style={{ width: "min(520px, calc(100% - 32px))", padding: "18px 22px", background: T.ground, border: `1px solid ${T.borderActive}`, borderRadius: 12, fontFamily: T.ui, display: "flex", flexDirection: "column", gap: 12 }}>
                <span style={{ fontFamily: T.display, fontSize: 22, color: T.emphasis }}>Epic of “{sessionName(session)}”</span>
                <input
                    ref={ref}
                    value={text}
                    maxLength={80}
                    placeholder="Type to narrow, or name a new epic"
                    onChange={(e) => (setText(e.target.value), setAt(0))}
                    onKeyDown={(e) => {
                        // ⌘1–9 as in ⌘N's sheet: a bare digit is typed, so a new epic may start with one ("2027 …").
                        const digit = e.metaKey && /^Digit\d$/.test(e.code) ? Number(e.code.slice(5)) : undefined;
                        if (digit === 0) return e.preventDefault(), assign(null);
                        if (digit !== undefined && open[digit - 1]) return e.preventDefault(), assign(open[digit - 1].id);
                        if (e.key === "ArrowDown") e.preventDefault(), setAt((i) => Math.min(i + 1, Math.max(shown.length - 1, 0)));
                        if (e.key === "ArrowUp") e.preventDefault(), setAt((i) => Math.max(i - 1, 0));
                        if (e.key === "Enter") e.preventDefault(), pick();
                        if (e.key === "Escape") e.preventDefault(), e.stopPropagation(), closeOverlay();
                    }}
                    style={{ padding: "7px 10px", background: T.card, border: `1px solid ${T.borderActive}`, borderRadius: 8, outline: "none", color: T.text, fontFamily: T.ui, fontSize: 14 }}
                />
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {shown.map((e, i) => (
                        <button
                            key={e.id}
                            type="button"
                            data-epic={e.id}
                            data-key={!q && i < 9 ? `⌘${i + 1}` : undefined}
                            tabIndex={-1}
                            onMouseDown={(ev) => ev.preventDefault()}
                            onClick={() => assign(e.id)}
                            style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 8, border: "none", cursor: "pointer", textAlign: "left", background: i === at ? T.cardActive : "transparent", color: T.text, fontFamily: T.ui, fontSize: 13.5 }}
                        >
                            <span style={{ width: 24, fontFamily: T.mono, fontSize: 11.5, color: T.muted }}>{!q && i < 9 ? `⌘${i + 1}` : ""}</span>
                            <EpicAvatar look={lookOf(e)} size={22} />
                            <span style={{ flexGrow: 1 }}>{e.title}</span>
                            {session.epic === e.id && <span style={{ fontSize: 11.5, color: T.muted }}>now</span>}
                        </button>
                    ))}
                    {q && !shown.length && (
                        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", color: T.secondary }}>
                            <EpicAvatar look={lookOf({ id: text.trim().toLowerCase() })} size={22} />
                            <span>New epic “{text.trim()}”</span>
                        </div>
                    )}
                    {!open.length && !q && (
                        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", color: T.muted }}>
                            <EpicAvatar look={NO_EPIC} size={22} />
                            <span>No epics yet: type a name and ⏎ starts one</span>
                        </div>
                    )}
                </div>
                <div style={{ display: "flex", gap: 22, fontSize: 12, color: T.muted, flexWrap: "wrap" }}>
                    <Key k="⏎" label={shown[at] ? "move it there" : q ? "start the epic" : "close"} />
                    <Key k="⌘1–9" label="pick" />
                    <Key k="⌘0" label="no epic" />
                    <Key k="esc" label="keep it" />
                </div>
            </div>
        </div>
    );
});
EpicPicker.displayName = "EpicPicker";
