import { globalStore } from "@/app/store/jotaiStore";
import { atoms } from "@/store/global";
import { memo, useState } from "react";
import { EpicAvatar } from "./EpicAvatar";
import { lookOf, NO_EPIC } from "./epicLook";
import { closeOverlay, focusedSession, latestSessions } from "./focus";
import { Key } from "./Key";
import { moveRefusal, moveSession } from "./menu";
import { T } from "./tokens";
import { useFocusOnMount } from "./useFocusOnMount";
import { useWintos } from "./useWintos";
import { sessionName } from "./view";

// ⌥⌘M: which view the focused session moves to. The views holding a session of its epic come
// first; mixing epics in one view is possible but never offered first. 1-9 pick, ⌥⌘T or t: a
// view of its own. When it can't move (its turn is at work), the sheet says so and stays.
export const MoveSession = memo(() => {
    const ref = useFocusOnMount<HTMLDivElement>();
    const { state } = useWintos();
    const [session] = useState(focusedSession);
    const [why, setWhy] = useState(moveRefusal);
    if (!session) return null;
    const here = globalStore.get(atoms.staticTabId);
    const live = latestSessions().filter((s) => s.state !== "ended");
    const open = new Set(globalStore.get(atoms.workspace)?.tabids ?? []);
    const tabs = [...new Set(live.map((s) => s.tabId))].filter((t) => t !== here && open.has(t));
    const title = (tabId: string) => state?.projects.find((p) => p.id === tabId)?.title ?? "Untitled view";
    const sameEpic = (tabId: string) => !!session.epic && live.some((s) => s.tabId === tabId && s.epic === session.epic);
    const views = [...tabs.filter(sameEpic), ...tabs.filter((t) => !sameEpic(t))];
    const go = (to: string | "new") => {
        const refused = moveSession(to);
        if (refused) setWhy(refused);
        else closeOverlay();
    };
    const lookOfSession = (epic?: string) => {
        const e = epic ? state?.epics?.find((x) => x.id === epic) : undefined;
        return e ? lookOf(e) : NO_EPIC;
    };
    return (
        <div style={{ position: "absolute", inset: 0, zIndex: 100, background: `color-mix(in srgb, ${T.ground} 70%, transparent)`, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "16vh" }} onClick={closeOverlay}>
            <div
                ref={ref}
                tabIndex={-1}
                data-wintos="move-session"
                data-zone="overlay"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                    const n = /^Digit[1-9]$/.test(e.code) ? Number(e.code.slice(5)) : undefined;
                    if (n !== undefined && views[n - 1]) return e.preventDefault(), go(views[n - 1]);
                    if (e.key === "t" || (e.code === "KeyT" && e.altKey && e.metaKey)) return e.preventDefault(), e.stopPropagation(), go("new");
                    if (e.key === "Escape") e.preventDefault(), e.stopPropagation(), closeOverlay();
                }}
                style={{ width: "min(520px, calc(100% - 32px))", padding: "18px 22px", background: T.ground, border: `1px solid ${T.borderActive}`, borderRadius: 12, fontFamily: T.ui, display: "flex", flexDirection: "column", gap: 12, outline: "none" }}
            >
                <span style={{ fontFamily: T.display, fontSize: 22, color: T.emphasis }}>Move “{sessionName(session)}”</span>
                {why && <span data-wintos="move-refused" style={{ fontSize: 12.5, color: T.apricot }}>{why}</span>}
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {views.map((tabId, i) => {
                        const inIt = live.filter((s) => s.tabId === tabId);
                        return (
                            <button key={tabId} type="button" data-view={tabId} data-key={i < 9 ? String(i + 1) : undefined} tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => go(tabId)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 8, border: "none", cursor: "pointer", textAlign: "left", background: "transparent", color: T.text, fontFamily: T.ui, fontSize: 13.5 }}>
                                <span style={{ width: 14, fontFamily: T.mono, fontSize: 11.5, color: T.muted }}>{i < 9 ? i + 1 : ""}</span>
                                <span style={{ display: "inline-flex", gap: 3 }}>{inIt.slice(0, 3).map((s) => <EpicAvatar key={s.id} look={lookOfSession(s.epic)} size={18} />)}</span>
                                <span style={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>⧉ {title(tabId)}</span>
                                <span style={{ fontSize: 11.5, color: T.muted, whiteSpace: "nowrap" }}>{inIt.map(sessionName).slice(0, 2).join(" · ")}</span>
                            </button>
                        );
                    })}
                    <button type="button" data-view="new" data-key="⌥⌘T" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => go("new")} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 8, border: "none", cursor: "pointer", textAlign: "left", background: "transparent", color: T.secondary, fontFamily: T.ui, fontSize: 13.5 }}>
                        <span style={{ width: 14, fontFamily: T.mono, fontSize: 11.5, color: T.muted }}>t</span>
                        <span>A view of its own</span>
                    </button>
                </div>
                <div style={{ display: "flex", gap: 22, fontSize: 12, color: T.muted, flexWrap: "wrap" }}>
                    <Key k="1–9" label="move it there" />
                    <Key k="t" label="a view of its own (⌥⌘T from anywhere)" />
                    <Key k="esc" label="leave it" />
                </div>
            </div>
        </div>
    );
});
MoveSession.displayName = "MoveSession";
