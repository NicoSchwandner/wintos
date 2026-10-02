import { memo, useMemo, useState } from "react";
import { carryToToday, leftFromYesterday, markPlanned, saveFocus } from "./day";
import { dayTimeline, focusList, parseLunch, type Block } from "./dayplan";
import { editMine } from "./focus";
import { Key } from "./Key";
import { meetingsFrom } from "./meetings";
import { Mine } from "./notes/Mine";
import { T } from "./tokens";
import { useFocusOnMount } from "./useFocusOnMount";
import { useNow } from "./useNow";
import { useWintos } from "./useWintos";
import { useZoneKeys } from "./zones";

const hm = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
const span = (ms: number) => {
    const m = Math.round(ms / 60_000);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ""}`;
};

// ⇧⌘Y: the day as its own page. The day drawn to scale (meetings, lunch, the free time left),
// what yesterday left open, and today's focus, edited like mine.md. In the morning, ⌘⏎ marks the
// day planned and the sidebar card stops pulsing.
export const TodayPage = memo(() => {
    const ref = useFocusOnMount<HTMLDivElement>();
    const { state } = useWintos();
    const now = useNow(30_000);
    const day = state?.day;
    const left = day ? leftFromYesterday(day) : [];
    const [cursor, setCursor] = useState(0);
    const carry = () => day && left[cursor] && void carryToToday(day, left[cursor]).then(() => setCursor((c) => Math.max(0, Math.min(c, left.length - 2))));
    useZoneKeys(ref, day ? {
        j: () => setCursor((c) => Math.min(c + 1, left.length - 1)),
        k: () => setCursor((c) => Math.max(c - 1, 0)),
        c: carry,
        "Cmd:e": () => editMine(true),
        "Cmd:Enter": () => void markPlanned(),
    } : {});
    if (!day) {
        return (
            <div ref={ref} tabIndex={0} data-zone="list" data-wintos="today" style={{ flexGrow: 1, padding: 26, fontFamily: T.ui, color: T.muted, outline: "none" }}>
                No journal yet. Set WINTOS_JOURNAL_DIR in ~/.config/wintos/env to your journal's folder of daily files and restart WintOS.
            </div>
        );
    }
    const y = day.yesterday;
    const yItems = y ? focusList(y.focus) : [];
    const todayTexts = new Set(focusList(day.focus).map((i) => i.text));
    const save = (text: string, base: number) => saveFocus(text, base).then((r) => (r === "ok" && !day.planned && text.trim() && void markPlanned(), r));
    const date = new Date(`${day.date}T12:00:00`);
    return (
        <div ref={ref} tabIndex={0} data-zone="list" data-wintos="today" style={{ flexGrow: 1, display: "flex", flexDirection: "column", gap: 16, padding: "18px 26px 0", background: "#1d2021", outline: "none", fontFamily: T.ui, minWidth: 0, minHeight: 0 }}>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <h1 style={{ margin: 0, fontFamily: T.display, fontSize: 30, fontWeight: 400, lineHeight: 1, color: T.emphasis }}>{date.toLocaleDateString("en-GB", { weekday: "long" })}</h1>
                    <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.muted }}>{date.toLocaleDateString("en-GB", { day: "numeric", month: "long" })} · {day.exists ? "in your journal" : "the journal file is made when you write the plan"}</span>
                </div>
                <Key k="esc" label="back" />
            </div>
            <div style={{ flexGrow: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(200px, 260px) minmax(0, 1fr)", gap: 20, paddingBottom: 14 }}>
                <Timeline now={now} />
                <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0, overflowY: "auto" }}>
                    {y && (
                        <Panel label="Yesterday" note={day.planned ? `${yItems.filter((i) => i.done).length} done · ${yItems.filter((i) => todayTexts.has(i.text)).length} carried` : undefined}>
                            {!day.planned && (
                                <>
                                    {yItems.filter((i) => i.done).map((i) => (
                                        <Item key={`d${i.line}`} text={i.text} done />
                                    ))}
                                    {left.map((t, n) => (
                                        <Item key={t} text={t} on={n === cursor} carry={() => (setCursor(n), void carryToToday(day, t))} />
                                    ))}
                                    {!yItems.length && !left.length && <span style={{ fontSize: 12, color: T.faint }}>Nothing planned yesterday.</span>}
                                </>
                            )}
                        </Panel>
                    )}
                    <Panel label="Today's focus" note={day.planned ? undefined : "not planned yet"} warn={!day.planned}>
                        <Mine text={day.focus} mtime={day.mtime} canEdit save={save} size="full" file="today's journal file" empty="Nothing planned yet. Press ⌘E and write one to three things that matter today." />
                    </Panel>
                </div>
            </div>
            <div style={{ margin: "0 -26px", borderTop: `1px solid ${T.hairline}`, background: T.sidebar, padding: "6px 16px", display: "flex", flexWrap: "wrap", gap: "6px 14px" }}>
                <Key k="⌘E" label="edit" />
                {left.length > 0 && !day.planned && <Key k="j k · c" label="carry from yesterday" />}
                {!day.planned && <Key k="⌘⏎" label="plan done" />}
                <Key k="esc" label="back" />
            </div>
        </div>
    );
});
TodayPage.displayName = "TodayPage";

function Panel({ label, note, warn, children }: { label: string; note?: string; warn?: boolean; children: React.ReactNode }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px", background: T.card, border: `1px solid ${warn ? T.apricot : T.border}`, borderRadius: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", color: T.faint, textTransform: "uppercase" }}>{label}</span>
                {note && <span style={{ fontFamily: T.mono, fontSize: 10.5, color: warn ? T.apricot : T.muted }}>{note}</span>}
            </div>
            {children}
        </div>
    );
}

function Item({ text, done, on, carry }: { text: string; done?: boolean; on?: boolean; carry?: () => void }) {
    return (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "3px 6px", margin: "0 -6px", borderRadius: 6, background: on ? T.cardActive : "transparent", fontSize: 13, lineHeight: 1.5, color: done ? T.muted : T.secondary, textDecoration: done ? "line-through" : undefined }}>
            <span style={{ width: 12, height: 12, marginTop: 4, flexShrink: 0, borderRadius: 3, border: `1.5px solid ${done ? T.moss : T.muted}`, background: done ? T.moss : "transparent" }} />
            <span style={{ flexGrow: 1, minWidth: 0, overflowWrap: "anywhere" }}>{text}</span>
            {carry && (
                <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={carry} title="Carry into today" style={{ flexShrink: 0, padding: 0, background: "transparent", border: "none", cursor: "pointer" }}>
                    <Key k="c" label="today" />
                </button>
            )}
        </div>
    );
}

// The day from 08 to 18 to scale: meetings, lunch, and the free time between, with now marked.
function Timeline({ now }: { now: number }) {
    const { state } = useWintos();
    const meetings = useMemo(() => meetingsFrom(state?.plugins), [state?.plugins]);
    const { blocks, freeMs, from, to } = dayTimeline(meetings, parseLunch(state?.lunch), new Date(now));
    const pct = (t: number) => `${((t - from) / (to - from)) * 100}%`;
    const hours = Array.from({ length: (to - from) / 3_600_000 + 1 }, (_, i) => from + i * 3_600_000);
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px", background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, minHeight: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", color: T.faint, textTransform: "uppercase" }}>Your day</span>
                <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.moss }}>{span(freeMs)} free</span>
            </div>
            <div style={{ position: "relative", flexGrow: 1, minHeight: 260, marginLeft: 34, borderLeft: `1px solid ${T.border}` }}>
                {hours.map((h, i) => (
                    <span key={h} style={{ position: "absolute", left: -34, top: pct(h), transform: "translateY(-50%)", fontFamily: T.mono, fontSize: 9.5, color: T.faint }}>{i % 2 === 0 ? hm(h).slice(0, 2) : ""}</span>
                ))}
                {blocks.map((b) => (
                    <TimeBlock key={`${b.kind}${b.start}`} b={b} top={pct(b.start)} height={`${((b.end - b.start) / (to - from)) * 100}%`} />
                ))}
                {now >= from && now <= to && <span style={{ position: "absolute", left: -3, right: 0, top: pct(now), height: 2, background: T.emphasis }} />}
            </div>
        </div>
    );
}

function TimeBlock({ b, top, height }: { b: Block; top: string; height: string }) {
    const base: React.CSSProperties = { position: "absolute", left: 6, right: 4, top, height, borderRadius: 5, padding: "1px 7px", overflow: "hidden", fontSize: 11, lineHeight: 1.35, boxSizing: "border-box" };
    if (b.kind === "meeting") return <div style={{ ...base, background: T.cardActive, border: `1px solid ${T.borderActive}`, color: T.secondary }}><span style={{ fontFamily: T.mono, fontSize: 9.5, color: T.muted }}>{hm(b.start)} </span>{b.title}</div>;
    if (b.kind === "lunch") return <div style={{ ...base, background: "repeating-linear-gradient(135deg, #32302f 0 6px, #2b2a29 6px 12px)", color: T.faint }}>Lunch</div>;
    return <div style={{ ...base, border: `1px dashed ${T.borderActive}`, color: T.moss, fontFamily: T.mono, fontSize: 9.5 }}>{span(b.end - b.start)} free</div>;
}
