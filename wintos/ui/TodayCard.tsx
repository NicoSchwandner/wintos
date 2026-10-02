import { memo } from "react";
import type { Day } from "../daemon/journal/journal";
import { leftFromYesterday, tickFocus } from "./day";
import { focusList } from "./dayplan";
import { Key } from "./Key";
import { toggleView } from "./menu";
import { Box } from "./notes/ProjectNotes";
import { T } from "./tokens";

const SHOWN = 3;

// Today's plan, with the other cards so it is in view everywhere. Until the day is planned it
// pulses apricot, as a meeting about to start does; then it lists what's still open, and a click
// on a box ticks it in the day's file.
// walk: the ⌘J/⌘K keys, which sit on whatever is marked as showing.
export const TodayCard = memo(({ day, active, walk }: { day: Day; active: boolean; walk?: React.ReactNode }) => {
    const items = focusList(day.focus);
    const open = items.filter((i) => !i.done);
    const done = items.length - open.length;
    const left = leftFromYesterday(day).length;
    return (
        <div
            data-wintos="today-card"
            onClick={() => toggleView("day")}
            style={{
                display: "flex", flexDirection: "column", gap: 5, padding: "9px 11px", borderRadius: 10, cursor: "pointer",
                background: active ? T.borderActive : T.card, boxShadow: active ? `inset 3px 0 0 ${T.emphasis}` : undefined,
                border: `1px solid ${day.planned ? T.border : T.apricot}`, animation: day.planned ? undefined : "wintos-breathe 2.4s ease-in-out infinite",
            }}
        >
            <style>{`@keyframes wintos-breathe { 0%,100% { box-shadow: 0 0 0 0 #fe801900 } 50% { box-shadow: 0 0 0 3px #fe801955 } } @media (prefers-reduced-motion: reduce) { [data-wintos=today-card] { animation: none !important } }`}</style>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: T.text }}>Today</span>
                <Key k="⇧⌘Y" label="" />
            </div>
            {!day.planned ? (
                <span style={{ fontSize: 11.5, color: T.apricot }}>Plan your day{left ? ` · ${left} left from yesterday` : ""}</span>
            ) : open.length === 0 ? (
                <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.muted }}>{items.length ? `all ${items.length} done` : "nothing planned"}</span>
            ) : (
                <>
                    {open.slice(0, SHOWN).map((i) => (
                        <div key={i.line} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, lineHeight: 1.4, color: T.secondary, minWidth: 0 }}>
                            <span onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.preventDefault()} style={{ display: "contents" }}>
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
