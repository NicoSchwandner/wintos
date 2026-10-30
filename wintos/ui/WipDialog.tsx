import { memo } from "react";
import { closeOverlay, focusSession, latestSessions } from "./focus";
import { Key } from "./Key";
import { inFlight, shownState } from "./sessions";
import { T } from "./tokens";
import { useFocusOnMount } from "./useFocusOnMount";
import { currentState, parkBlock } from "./useWintos";
import { relTime, sessionName } from "./view";
import { useZoneKeys } from "./zones";

// ⇧⌘T or ⌘N at the limit on sessions in flight (WINTOS_WIP): 1 goes to the turn that has waited
// on you longest, 2 parks it, the same key again starts the new one anyway, esc keeps things.
export const WipDialog = memo(() => {
    const ref = useFocusOnMount<HTMLDivElement>();
    const now = Date.now();
    const sessions = latestSessions();
    const n = inFlight(sessions, now);
    const oldest = sessions.filter((s) => s.state !== "ended" && !s.background && !s.restored && shownState(s, now) === "waiting").sort((a, b) => a.since - b.since)[0];
    const title = (tabId: string) => currentState()?.projects.find((p) => p.id === tabId)?.title ?? "its project";
    const go = () => oldest && (closeOverlay(), focusSession({ tabId: oldest.tabId, blockId: oldest.blockId }));
    const park = () => oldest && (void parkBlock(oldest.blockId), closeOverlay());
    useZoneKeys(ref, { "1": () => void go(), "2": () => void park() });
    const limit = currentState()?.wip ?? 0;
    return (
        <div style={{ position: "absolute", inset: 0, zIndex: 100, background: "rgba(15,16,17,0.6)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "16vh" }} onClick={closeOverlay}>
            <div ref={ref} tabIndex={0} data-wintos="wip" data-zone="overlay" onClick={(e) => e.stopPropagation()} style={{ width: 540, padding: "22px 26px", background: T.card, border: `1px solid ${T.borderActive}`, borderRadius: 14, fontFamily: T.ui, outline: "none", display: "flex", flexDirection: "column", gap: 14, boxShadow: "0 22px 52px rgba(0,0,0,0.72)" }}>
                <span style={{ fontFamily: T.display, fontSize: 26, color: T.emphasis }}>One more in flight?</span>
                <span style={{ fontSize: 13.5, lineHeight: 1.5, color: T.secondary }}>
                    {n.working + n.waiting} in flight against your limit of {limit}: {n.working} working, {n.waiting} waiting on you. Finishing or parking one first keeps each a little more in your head.
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {oldest && (
                        <>
                            <button type="button" data-key="1" tabIndex={-1} onClick={go} style={ROW}>
                                <Key k="1" label="" />
                                <span style={{ flexGrow: 1 }}>Go to {sessionName(oldest)} in {title(oldest.tabId)}</span>
                                <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.faint }}>waiting {relTime(now - oldest.since)}</span>
                            </button>
                            <button type="button" data-key="2" tabIndex={-1} onClick={park} style={ROW}>
                                <Key k="2" label="" />
                                <span style={{ flexGrow: 1 }}>Park it: nothing for you there now</span>
                            </button>
                        </>
                    )}
                    <span style={{ display: "flex", gap: 18, padding: "6px 2px 0", fontSize: 12, color: T.muted }}>
                        <Key k="⇧⌘T / ⌘N" label="again: start it anyway" />
                        <Key k="esc" label="not now" />
                    </span>
                </div>
            </div>
        </div>
    );
});
WipDialog.displayName = "WipDialog";

const ROW: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, padding: "9px 12px", background: T.cardActive, border: "none", borderRadius: 9, color: T.text, fontFamily: T.ui, fontSize: 13.5, textAlign: "left", cursor: "pointer" };
