import { getLayoutModelForStaticTab } from "@/layout/index";
import { getWaveObjectAtom, makeORef } from "@/app/store/wos";
import { atom, useAtomValue } from "jotai";
import { getSettingsKeyAtom } from "@/app/store/global";
import { memo, useEffect, useMemo, useRef, useState } from "react";

const STRIP_GAP = 6; // above the chips, and (with the tile gap) below them
import { focusSession, takeHandoff } from "./focus";
import { Key } from "./Key";
import { confirmPaneClose, copiedAtAtom, focusedPageUrl, runKey, shelvePane } from "./menu";
import { openPalette } from "./Palette";
import { closeArmedAtom, restartArmedAtom } from "./notes/state";
import { paneOrder, stripPanes } from "./panes";
import { attachments, liveSessions, unreadSessions } from "./sessions";
import { SESSION_DOT, T } from "./tokens";
import { useNow } from "./useNow";
import { daemonFetch, useWintos } from "./useWintos";
import { isInboxTab, relTime } from "./view";

// A pane's chip is edged in its session's colour when it is not the one shown: what waits on you
// or is working reads at a glance even with another pane magnified.
const STATE_BORDER: Record<string, string> = { waiting: T.apricot, working: T.moss };

const GLYPH = { terminal: "›_", web: "◎", other: "□" } as const;

// One chip per pane of this tab (Claude sessions, terminals, browser pages), in projects and the
// Inbox alike. A click or ⌘H/⌘L moves to a pane; ⌘W closes the focused one.
export const PaneStrip = memo(({ tabId }: { tabId: string }) => {
    const { state } = useWintos();
    const tab = useAtomValue(getWaveObjectAtom<Tab>(makeORef("tab", tabId)));
    const tileGapSetting = useAtomValue(getSettingsKeyAtom("window:tilegapsize"));
    const lm = getLayoutModelForStaticTab();
    const ids = paneOrder(useAtomValue(lm.leafOrder), tab?.blockids ?? []);
    const blocks = useAtomValue(useMemo(() => atom((get) => ids.map((id) => get(getWaveObjectAtom<Block>(makeORef("block", id))))), [ids.join(",")]));
    const now = useNow();
    const magnified = useAtomValue(lm.magnifiedNodeIdAtom);
    const focused = useAtomValue(lm.focusedNode);
    const armed = useAtomValue(restartArmedAtom);
    const closeArmed = useAtomValue(closeArmedAtom);

    useEffect(() => {
        takeHandoff();
        window.addEventListener("storage", takeHandoff);
        document.addEventListener("visibilitychange", takeHandoff);
        return () => (window.removeEventListener("storage", takeHandoff), document.removeEventListener("visibilitychange", takeHandoff));
    }, []);

    // Panes attached to a session that runs in the background service: tell the daemon where it shows.
    const attached = useRef(new Set<string>());
    const attach = state ? attachments(blocks.map((b, i) => ({ blockId: ids[i], script: b?.meta?.["cmd:initscript"] as string | undefined })), state.sessions, tabId, attached.current) : [];
    const attachKey = attach.map((a) => `${a.sessionId}@${a.blockId}`).join(" ");
    useEffect(() => {
        for (const a of attach) {
            const key = `${a.sessionId}@${a.blockId}`;
            attached.current.add(key);
            // Only a refused or lost attach is tried again.
            void daemonFetch(`/sessions/${encodeURIComponent(a.sessionId)}/attach`, { method: "POST", body: { tabId, blockId: a.blockId } })
                .then((r) => void (r.ok || attached.current.delete(key)), () => void attached.current.delete(key));
        }
    }, [attachKey]);
    const sessions = state ? liveSessions(state.sessions, { [tabId]: ids }) : [];
    const chips = stripPanes(blocks, sessions);
    // The strip is where every pane's controls live, so it shows whenever there is a pane.
    if (!chips.length) return null;
    const unread = new Set(unreadSessions(sessions, tabId, state?.seen).map((s) => s.id));
    const on = magnified ?? focused?.id;
    const inProject = !isInboxTab(tab);
    // As much room under the chips as above them: the panes below already sit half the tile
    // gap (window:tilegapsize) down, so the strip adds only the rest.
    const tileGap = Number(tileGapSetting ?? 3);
    return (
        // The strip's empty space drags the window. The chips' row doesn't, gaps included: a drag
        // region takes the wheel too, and the row scrolls sideways when it overflows.
        <div style={{ display: "flex", padding: `${STRIP_GAP}px 8px ${Math.max(0, STRIP_GAP - tileGap / 2)}px`, flexShrink: 0, WebkitAppRegion: "drag" } as React.CSSProperties}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, fontFamily: T.mono, fontSize: 11, overflowX: "auto", WebkitAppRegion: "no-drag" } as React.CSSProperties}>
            {/* ⌘H / ⌘L step pane by pane (in an Inbox tab from the list through its pages). */}
            {(chips.length > 1 || !inProject) && (
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
                        data-key="⌘H / ⌘L"
                        onClick={() => focusSession({ tabId, blockId: c.blockId })}
                        style={{ WebkitAppRegion: "no-drag", display: "inline-flex", alignItems: "center", gap: 7, maxWidth: 240, padding: "5px 10px", borderRadius: 8, border: `1px solid ${isOn ? T.borderActive : (STATE_BORDER[s?.state ?? ""] ?? T.border)}`, background: isOn ? T.cardActive : "transparent", color: isOn ? T.emphasis : T.secondary, cursor: "pointer", whiteSpace: "nowrap", fontFamily: T.mono, fontSize: 11 } as React.CSSProperties}
                    >
                        {s ? (
                            // Unread: a ring in the to-read colour until you have looked.
                            <span style={{ width: 6, height: 6, flexShrink: 0, borderRadius: "50%", background: SESSION_DOT[s.state], boxShadow: unread.has(s.id) && s.state !== "waiting" ? `0 0 0 2px ${T.blue}` : undefined }} />
                        ) : (
                            <span style={{ color: T.muted }}>{GLYPH[c.kind as keyof typeof GLYPH]}</span>
                        )}
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{c.label}</span>
                        {s?.state === "waiting" && <span style={{ color: T.apricot }}>{relTime(now - s.since)}</span>}
                    </button>
                );
            })}
            {(chips.length > 1 || !inProject) && (
                <span style={{ marginLeft: 6 }}>
                    <Key k="⌘L" label="→" />
                </span>
            )}
            {/* The focused pane's controls, the same for a terminal and a page. */}
            {inProject && chips.length > 1 && !magnified && focused && <StripAction k="⌘M" label="magnify" onClick={() => lm.magnifyNodeToggle(focused.id)} />}
            {focused && focusedPageUrl(blocks[ids.indexOf(focused.data?.blockId)]) && <CopyUrl />}
            {focused && focusedPageUrl(blocks[ids.indexOf(focused.data?.blockId)]) && <StripAction k="⇧⌘U" label="browser" onClick={() => runKey("open-external")} />}
            {focused && <StripAction k="⌘W" label="close" onClick={() => confirmPaneClose(focused.data?.blockId) && (shelvePane(focused.data?.blockId), void lm.closeNode(focused.id))} />}
            {closeArmed && focused?.data?.blockId === closeArmed && (
                <span style={{ marginLeft: 10, display: "inline-flex", alignItems: "center", gap: 7, color: T.brick }}>
                    <Key k="⌘W" label="again to stop the working session" />
                </span>
            )}
            {armed && focused?.data?.blockId === armed && (
                <span style={{ marginLeft: 10, display: "inline-flex", alignItems: "center", gap: 7, color: T.brick }}>
                    <Key k="⌥⌘R" label="again to restart this terminal" />
                </span>
            )}
            {/* Magnify hides the other panes and has no header button here: say so, and offer the way back. */}
            {magnified && inProject && (
                <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    tabIndex={-1}
                    data-key="⌘M"
                    onClick={() => lm.magnifyNodeToggle(magnified)}
                    title="Show all panes again"
                    style={{ WebkitAppRegion: "no-drag", marginLeft: 8, display: "inline-flex", alignItems: "center", gap: 7, padding: "3px 9px", borderRadius: 8, border: `1px solid ${T.apricot}`, background: "transparent", color: T.apricot, cursor: "pointer", fontFamily: T.mono, fontSize: 11 } as React.CSSProperties}
                >
                    magnified
                    <Key k="⌘M" label="all panes" />
                </button>
            )}
        </div>
        </div>
    );
});
PaneStrip.displayName = "PaneStrip";

function CopyUrl() {
    const copiedAt = useAtomValue(copiedAtAtom);
    const [, rerender] = useState(0);
    const copied = Date.now() - copiedAt < 1500;
    useEffect(() => {
        if (!copied) return;
        const t = setTimeout(() => rerender((n) => n + 1), 1500);
        return () => clearTimeout(t);
    }, [copiedAt]);
    return <StripAction k="⇧⌘C" label={copied ? "copied" : "copy url"} onClick={() => runKey("copy-url")} />;
}

// A key hint you can also click; it never takes focus, which stays in the pane.
function StripAction({ k, label, onClick }: { k: string; label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            tabIndex={-1}
            data-key={k}
            onClick={onClick}
            style={{ WebkitAppRegion: "no-drag", marginLeft: 10, padding: 0, background: "transparent", border: "none", cursor: "pointer" } as React.CSSProperties}
        >
            <Key k={k} label={label} />
        </button>
    );
}
