import { getLayoutModelForStaticTab } from "@/layout/index";
import { getWaveObjectAtom, makeORef } from "@/app/store/wos";
import { atom, useAtomValue } from "jotai";
import { memo, useEffect, useMemo } from "react";
import { focusSession, takeHandoff } from "./focus";
import { Key } from "./Key";
import { paneOrder, stripPanes } from "./panes";
import { liveSessions, unreadSessions } from "./sessions";
import { T } from "./tokens";
import { useNow } from "./useNow";
import { useWintos } from "./useWintos";
import { isInboxTab, relTime } from "./view";

const DOT = { working: T.moss, waiting: T.apricot, parked: T.muted, done: T.dim, idle: T.dim, ended: T.dim } as const;
const GLYPH = { terminal: "›_", web: "◎", other: "□" } as const;

// One chip per pane of this tab (Claude sessions, terminals, browser pages), in projects and the
// Inbox alike. A click or ⌘H/⌘L moves to a pane; ⌘W closes the focused one.
export const PaneStrip = memo(({ tabId }: { tabId: string }) => {
    const { state } = useWintos();
    const tab = useAtomValue(getWaveObjectAtom<Tab>(makeORef("tab", tabId)));
    const lm = getLayoutModelForStaticTab();
    const ids = paneOrder(useAtomValue(lm.leafOrder), tab?.blockids ?? []);
    const blocks = useAtomValue(useMemo(() => atom((get) => ids.map((id) => get(getWaveObjectAtom<Block>(makeORef("block", id))))), [ids.join(",")]));
    const now = useNow();
    const magnified = useAtomValue(lm.magnifiedNodeIdAtom);
    const focused = useAtomValue(lm.focusedNode);

    useEffect(() => {
        takeHandoff();
        window.addEventListener("storage", takeHandoff);
        document.addEventListener("visibilitychange", takeHandoff);
        return () => (window.removeEventListener("storage", takeHandoff), document.removeEventListener("visibilitychange", takeHandoff));
    }, []);

    const sessions = state ? liveSessions(state.sessions, { [tabId]: ids }) : [];
    const chips = stripPanes(blocks, sessions);
    // A lone plain pane needs no strip; a Claude session always shows its state.
    if (chips.length < 2 && !chips.some((c) => c.kind === "session")) return null;
    const unread = new Set(unreadSessions(sessions, tabId, state?.seen?.[tabId]).map((s) => s.id));
    const on = magnified ?? focused?.id;
    const inProject = !isInboxTab(tab);
    return (
        // The strip's empty space drags the window; the chips don't.
        <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 8px 0", fontFamily: T.mono, fontSize: 11, flexShrink: 0, overflowX: "auto", WebkitAppRegion: "drag" } as React.CSSProperties}>
            {/* ⌘H / ⌘L step pane by pane in a project; in an Inbox tab they move between list and page. */}
            {inProject && chips.length > 1 && (
                <span style={{ marginRight: 6 }}>
                    <Key k="⌘H" label="←" />
                </span>
            )}
            {chips.map((c) => {
                const isOn = on != null && on === lm.getNodeByBlockId(c.blockId)?.id;
                const s = c.session;
                return (
                    <button
                        key={c.blockId}
                        data-pane={c.blockId}
                        data-on={isOn || undefined}
                        type="button"
                        // Neither a click nor Tab leaves focus on the chip, outside every zone.
                        onMouseDown={(e) => e.preventDefault()}
                        tabIndex={-1}
                        onClick={() => focusSession({ tabId, blockId: c.blockId })}
                        style={{ WebkitAppRegion: "no-drag", display: "inline-flex", alignItems: "center", gap: 7, maxWidth: 240, padding: "5px 10px", borderRadius: 8, border: `1px solid ${isOn ? T.borderActive : T.border}`, background: isOn ? T.cardActive : "transparent", color: isOn ? T.emphasis : T.secondary, cursor: "pointer", whiteSpace: "nowrap", fontFamily: T.mono, fontSize: 11 } as React.CSSProperties}
                    >
                        {s ? (
                            // Unread: a ring in the waiting colour until you have looked.
                            <span style={{ width: 6, height: 6, flexShrink: 0, borderRadius: "50%", background: DOT[s.state], boxShadow: unread.has(s.id) && s.state !== "waiting" ? `0 0 0 2px ${T.apricot}` : undefined }} />
                        ) : (
                            <span style={{ color: T.muted }}>{GLYPH[c.kind as keyof typeof GLYPH]}</span>
                        )}
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{c.label}</span>
                        {s?.state === "waiting" && <span style={{ color: T.apricot }}>{relTime(now - s.since)}</span>}
                    </button>
                );
            })}
            {inProject && chips.length > 1 && (
                <span style={{ marginLeft: 6 }}>
                    <Key k="⌘L" label="→" />
                </span>
            )}
            {inProject && chips.length > 1 && !magnified && (
                <span style={{ marginLeft: 12 }}>
                    <Key k="⌘M" label="magnify" />
                </span>
            )}
            {/* Magnify hides the other panes and has no header button here: say so, and offer the way back. */}
            {magnified && inProject && (
                <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    tabIndex={-1}
                    onClick={() => lm.magnifyNodeToggle(magnified)}
                    title="Show all panes again"
                    style={{ WebkitAppRegion: "no-drag", marginLeft: 8, display: "inline-flex", alignItems: "center", gap: 7, padding: "3px 9px", borderRadius: 8, border: `1px solid ${T.apricot}`, background: "transparent", color: T.apricot, cursor: "pointer", fontFamily: T.mono, fontSize: 11 } as React.CSSProperties}
                >
                    magnified
                    <Key k="⌘M" label="all panes" />
                </button>
            )}
        </div>
    );
});
PaneStrip.displayName = "PaneStrip";
