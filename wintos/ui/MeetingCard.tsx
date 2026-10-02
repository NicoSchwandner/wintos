import { memo, useEffect } from "react";
import { Key } from "./Key";
import { clock, countdown, nextMeetings, setLatestMeetings, WARN_MS, type Meeting } from "./meetings";
import { T } from "./tokens";
import { useNow } from "./useNow";

// The next meeting, with the other cards (design A). Two minutes before it starts, the border
// turns apricot and breathes and the countdown runs in seconds; never a popup.
export const MeetingCard = memo(({ meetings }: { meetings: Meeting[] }) => {
    useEffect(() => void setLatestMeetings(meetings), [meetings]);
    const now = useNow(1000);
    const n = nextMeetings(meetings, now);
    const shown = n.now && !n.soon ? n.now : n.next;
    if (!shown) return null;
    const on = shown === n.now;
    const then = on ? n.next : n.after;
    return (
        <div
            data-wintos="meeting-card"
            style={{
                display: "flex", flexDirection: "column", gap: 3, padding: "9px 11px", borderRadius: 10, background: T.card,
                border: `1px solid ${n.soon ? T.apricot : T.border}`, animation: n.soon ? "wintos-breathe 2.4s ease-in-out infinite" : undefined,
            }}
        >
            <style>{`@keyframes wintos-breathe { 0%,100% { box-shadow: 0 0 0 0 #fe801900 } 50% { box-shadow: 0 0 0 3px #fe801955 } } @media (prefers-reduced-motion: reduce) { [data-wintos=meeting-card] { animation: none !important } }`}</style>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontFamily: T.mono, fontSize: 10.5, color: T.muted, fontVariantNumeric: "tabular-nums" }}>
                <span>{clock(shown.start)} – {clock(shown.end)}</span>
                <span style={{ color: n.soon ? T.apricot : on ? T.moss : T.muted }}>{on ? "now" : countdown(n.msLeft!)}</span>
            </div>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shown.title}</span>
            {(then || shown.url) && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 11, color: T.faint }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{then ? `then ${clock(then.start)} ${then.title}` : ""}</span>
                    {shown.url && <Key k="⇧⌘M" label="join" />}
                </div>
            )}
        </div>
    );
});
MeetingCard.displayName = "MeetingCard";

// The window's top edge (design D): in the last two minutes an apricot line fills from left to
// right and is full when the meeting starts. Never takes a click.
export const MeetingEdge = memo(({ meetings }: { meetings: Meeting[] }) => {
    const now = useNow(1000);
    const n = nextMeetings(meetings, now);
    if (!n.soon) return null;
    const done = 1 - n.msLeft! / WARN_MS;
    return (
        <div aria-hidden style={{ position: "fixed", top: 0, left: 0, right: 0, height: 3, zIndex: 1000, pointerEvents: "none", background: "#fe801933" }}>
            <div style={{ height: "100%", width: `${Math.round(done * 1000) / 10}%`, background: T.apricot, transition: "width 1s linear" }} />
        </div>
    );
});
MeetingEdge.displayName = "MeetingEdge";
