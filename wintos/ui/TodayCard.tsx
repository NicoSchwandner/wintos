import { globalStore } from "@/app/store/jotaiStore";
import { useAtomValue } from "jotai";
import { memo, useEffect, useRef } from "react";
import { focusArea } from "./focus";
import { returnFocus } from "./focusOwner";
import { cursorKeys, startCursor } from "./itemCursor";
import { tickModeAtom } from "./notes/state";
import { useZoneKeys } from "./zones";
import type { Day } from "../daemon/journal/journal";
import { lastDayName, leftFromYesterday, tickFocus } from "./day";
import { focusList } from "./dayplan";
import { Key } from "./Key";
import { openView } from "./menu";
import { Box } from "./notes/ProjectNotes";
import { T } from "./tokens";

const SHOWN = 3;
const SHOWN_TICKING = 15;
const since = (last: string, today: string) => lastDayName(last, today).replace(/^(Yesterday|Last)/, (w) => w.toLowerCase());

// Today's plan, with the other cards so it is in view everywhere. Until the day is planned it
// pulses apricot, as a meeting about to start does; then it lists what's still open, and a click
// on a box ticks it in the day's file.
// walk: the ⌘J/⌘K keys, which sit on whatever is marked as showing.
export const TodayCard = memo(({ day, active, cursor, walk }: { day: Day; active: boolean; cursor?: boolean; walk?: React.ReactNode }) => {
    const ticking = useAtomValue(tickModeAtom);
    if (ticking && day.planned && focusList(day.focus).some((i) => !i.done)) return <TickList day={day} />;
    const items = focusList(day.focus);
    const open = items.filter((i) => !i.done);
    const done = items.length - open.length;
    const left = leftFromYesterday(day).length;
    return (
        <div
            data-wintos="today-card"
            data-key={active ? "" : "⇧⌘Y"}
            onClick={() => openView("day")}
            style={{
                display: "flex", flexDirection: "column", gap: 5, padding: "9px 11px", borderRadius: 10, cursor: "pointer",
                background: active ? T.borderActive : T.card, boxShadow: active ? `inset 3px 0 0 ${T.emphasis}` : undefined,
                border: `1px solid ${cursor || !day.planned ? T.apricot : T.border}`, animation: day.planned ? undefined : "wintos-breathe 2.4s ease-in-out infinite",
            }}
        >
            <style>{`@keyframes wintos-breathe { 0%,100% { box-shadow: 0 0 0 0 #fe801900 } 50% { box-shadow: 0 0 0 3px #fe801955 } } @media (prefers-reduced-motion: reduce) { [data-wintos=today-card] { animation: none !important } }`}</style>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: T.text }}>Today</span>
                <Key k="⇧⌘Y" label="" />
            </div>
            {!day.planned ? (
                <span style={{ fontSize: 11.5, color: T.apricot }}>Plan your day{left && day.yesterday ? ` · ${left} left from ${since(day.yesterday.date, day.date)}` : ""}</span>
            ) : open.length === 0 ? (
                <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.muted }}>{items.length ? `all ${items.length} done` : "nothing planned"}</span>
            ) : (
                <>
                    {open.slice(0, SHOWN).map((i) => (
                        <div key={i.line} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, lineHeight: 1.4, color: T.secondary, minWidth: 0 }}>
                            <span data-key="" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.preventDefault()} style={{ display: "contents" }}>
                                <Box state="todo" size="rail" onToggle={() => void tickFocus(day, i.line)} />
                            </span>
                            <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{i.text}</span>
                        </div>
                    ))}
                    <span style={{ fontFamily: T.mono, fontSize: 10, color: T.faint }}>
                        {[open.length > SHOWN ? `+${open.length - SHOWN} more` : "", done ? `${done} done` : ""].filter(Boolean).join(" · ")}
                    </span>
                </>
            )}
            {active && walk}
        </div>
    );
});
TodayCard.displayName = "TodayCard";

// ⌥⌘X: the card unfolded, up to 15 open items, the cursor on the first: j/k move, x ticks, Esc
// folds it back to where you were. The same keys as on the Today page.
function TickList({ day }: { day: Day }) {
    const ref = useRef<HTMLDivElement>(null);
    const open = focusList(day.focus).filter((i) => !i.done);
    const close = () => (globalStore.set(tickModeAtom, false), returnFocus(() => focusArea("terminal")));
    useZoneKeys(ref, { ...cursorKeys(() => ref.current), Escape: close });
    useEffect(() => {
        ref.current?.focus();
        if (ref.current) startCursor(ref.current, () => true);
    }, []);
    // The last one ticked: nothing left to tick, so the card folds back by itself.
    useEffect(() => void (open.length === 0 && close()), [open.length]);
    return (
        <div ref={ref} tabIndex={0} data-zone="list" data-wintos="today-ticking" style={{ display: "flex", flexDirection: "column", gap: 6, padding: "9px 11px", borderRadius: 10, outline: "none", background: T.card, border: `1px solid ${T.borderActive}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: T.text }}>Tick off</span>
                <span style={{ display: "flex", gap: 8 }}>
                    <Key k="j k · x" label="" />
                    <Key k="esc" label="" />
                </span>
            </div>
            {open.slice(0, SHOWN_TICKING).map((i) => (
                <div key={i.line} data-item="check" style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, lineHeight: 1.4, color: T.secondary, minWidth: 0, padding: "1px 4px", margin: "0 -4px", borderRadius: 4 }}>
                    <span data-act data-key="x" onMouseDown={(e) => e.preventDefault()} style={{ display: "contents" }}>
                        <Box state="todo" size="rail" onToggle={() => void tickFocus(day, i.line)} />
                    </span>
                    <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{i.text}</span>
                </div>
            ))}
            {open.length > SHOWN_TICKING && <span style={{ fontFamily: T.mono, fontSize: 10, color: T.faint }}>+{open.length - SHOWN_TICKING} more on the Today page</span>}
        </div>
    );
}
