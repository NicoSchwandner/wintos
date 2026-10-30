import { useAtomValue } from "jotai";
import { memo } from "react";
import { nudge, type Nudge } from "../daemon/rhythm/rhythm";
import { parseSpan } from "./dayplan";
import { Key } from "./Key";
import { runKey } from "./menu";
import { overlayAtom, yourMoveAtom } from "./notes/state";
import { shownState } from "./sessions";
import { T } from "./tokens";
import { useNow } from "./useNow";
import { useWintos } from "./useWintos";

const WORDS: Record<Nudge["kind"], (minutes: number, working: number) => [string, string]> = {
    move: (m, w) => ["A good moment to move", `${m} minute${m === 1 ? "" : "s"} at it, nothing needs you${w ? `, ${w} session${w === 1 ? " is" : "s are"} working` : ""}. A 3-minute walk now; what comes in waits for you.`],
    dispatch: (_m, w) => ["The next minutes are yours", `You sent a long task and ${w === 1 ? "the session is" : `all ${w} sessions are`} working. Step away while they run.`],
    lunch: () => ["No lunch break yet", "Nothing of 20 minutes or more since lunch began. Eat something; everything stays as it is."],
};

// The nudge to move, at a natural pause: nothing in Your move, and the stretch since your last
// break as long as WINTOS_MOVE_EVERY (rhythm.ts decides). ⌥⌘B takes the break, ⇧⌥⌘B asks again later.
export const MoveNudge = memo(() => {
    const { state } = useWintos();
    const now = useNow(30_000);
    const yourMove = useAtomValue(yourMoveAtom);
    const overlay = useAtomValue(overlayAtom);
    const r = state?.rhythm;
    if (!r || overlay) return null;
    const working = (state?.sessions ?? []).filter((s) => !s.background && !s.restored && shownState(s, now) === "working").length;
    const n = nudge(r, { now, everyMs: r.everyMs, needs: yourMove, working, live: working, lunch: parseSpan(state?.lunch), today: new Date(now) });
    if (!n) return null;
    const [title, line] = WORDS[n.kind](n.minutes, working);
    return (
        <div data-wintos="move-nudge" data-kind={n.kind} style={{ position: "absolute", left: 24, right: 24, bottom: 46, zIndex: 80, maxWidth: 820, margin: "0 auto", display: "flex", alignItems: "center", gap: 18, padding: "14px 18px", background: T.card, border: `1px solid ${T.moss}`, borderRadius: 14, boxShadow: "0 18px 40px rgba(0,0,0,0.6)", fontFamily: T.ui }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={T.moss} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                <circle cx="13" cy="4" r="2" />
                <path d="M9 21l2-6 3 3v3" />
                <path d="M7 12l3-4 4 1 3 3" />
                <path d="M11 15l-1-5" />
            </svg>
            <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 14.5, fontWeight: 600, color: T.emphasis }}>{title}</span>
                <span style={{ fontSize: 12.5, lineHeight: 1.45, color: T.secondary }}>{line}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", flexShrink: 0 }}>
                <button type="button" data-key="⌥⌘B" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => runKey("break")} style={{ padding: 0, background: "transparent", border: "none", cursor: "pointer" }}>
                    <Key k="⌥⌘B" label="break, 3 min" />
                </button>
                <button type="button" data-key="⇧⌥⌘B" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => runKey("break-later")} style={{ padding: 0, background: "transparent", border: "none", cursor: "pointer" }}>
                    <Key k="⇧⌥⌘B" label="in 10 min" />
                </button>
            </div>
        </div>
    );
});
MoveNudge.displayName = "MoveNudge";
