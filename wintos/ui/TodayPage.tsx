import { useAtomValue } from "jotai";
import { memo, useEffect, useMemo, useState } from "react";
import { carryToToday, lastDayName, leftFromYesterday, markPlanned, saveFocus, yesterdayItems } from "./day";
import { dayTimeline, DEFAULT_WORKDAY, focusList, parseSpan, type Block } from "./dayplan";
import { editMine } from "./focus";
import { Key } from "./Key";
import { meetingsFrom } from "./meetings";
import { Mine } from "./notes/Mine";
import { More, Rich } from "./notes/ProjectNotes";
import { editingMineAtom } from "./notes/state";
import { T } from "./tokens";
import { useFocusOnMount } from "./useFocusOnMount";
import { useNow } from "./useNow";
import { daemonFetch, useWintos } from "./useWintos";
import { useZoneKeys } from "./zones";
import { cursorKeys, startCursor } from "./itemCursor";

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
    const editing = useAtomValue(editingMineAtom);
    const left = day ? leftFromYesterday(day) : [];
    // Once the day is planned, yesterday's list folds to its count; m shows it again.
    const [showYesterday, setShowYesterday] = useState(false);
    // The page opens on your first open item, so ⇧⌘Y x ticks it.
    const hasDay = !!day;
    useEffect(() => {
        if (hasDay && ref.current) requestAnimationFrame(() => ref.current && startCursor(ref.current, (el) => el.dataset.item === "check" && !el.dataset.done));
    }, [hasDay]);
    useZoneKeys(ref, day ? {
        ...cursorKeys(() => ref.current),
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
            <div style={{ flexGrow: 1, minHeight: 0, display: "grid", gridTemplateColumns: "clamp(220px, 26vw, 400px) minmax(0, 760px)", gap: 20, paddingBottom: 18 }}>
                <Timeline now={now} />
                <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0, overflowY: "auto" }}>
                    <WhatYouDid today={day.date} />
                    {y && (
                        <Panel label={lastDayName(y.date, day.date)} note={day.planned ? `${yItems.filter((i) => i.done).length} done · ${yesterdayItems(day).filter((i) => i.carried).length} carried` : undefined} keys={!day.planned && yesterdayItems(day).some((i) => !i.carried) && <Key k="j k · c" label="carry" />}>
                            {(!day.planned || showYesterday) && (
                                <>
                                    {yesterdayItems(day).map((i) => (
                                        <Item key={i.text} text={i.text} depth={i.depth} done={i.done} carried={i.carried} carry={i.carried ? undefined : () => void carryToToday(day, i.text)} />
                                    ))}
                                    {!yesterdayItems(day).length && <span style={{ fontSize: 12, color: T.faint }}>Nothing was planned.</span>}
                                </>
                            )}
                            {day.planned && yItems.length > 0 && <More open={showYesterday} label={`Show the ${yItems.length} items`} onClick={() => setShowYesterday(!showYesterday)} />}
                        </Panel>
                    )}
                    <Panel
                        label="Today's focus"
                        note={day.planned ? undefined : "not planned yet"}
                        warn={!day.planned}
                        keys={editing ? <><Key k="⌘⏎" label="save" /><Key k="esc" label="discard" /></> : <><Key k="⌘E" label="edit" />{!day.planned && <Key k="⌘⏎" label="plan done" />}</>}
                    >
                        <Mine text={day.focus} mtime={day.mtime} canEdit save={save} size="full" file="today's journal file" empty={left.length ? `Nothing planned yet. ⌘E starts from the ${left.length} things yesterday left open.` : "Nothing planned yet. Press ⌘E and write one to three things that matter today."} start={left.map((t) => `- [ ] ${t}`).join("\n")} />
                    </Panel>
                </div>
            </div>
        </div>
    );
});
TodayPage.displayName = "TodayPage";

// keys: the panel's own shortcuts, shown on it rather than in a footer.
// For the daily: the last worked day in at most five lines, condensed by the daemon from the
// recaps your Claude sessions wrote in each project. Folded; m opens it.
function WhatYouDid({ today }: { today: string }) {
    const [recap, setRecap] = useState<{ date: string; bullets: string[] } | null | undefined>();
    const [open, setOpen] = useState(false);
    useEffect(() => {
        let live = true;
        daemonFetch("/day/recap")
            .then((r) => (r.ok ? r.json() : null))
            .then((r) => live && setRecap(r), () => live && setRecap(null));
        return () => void (live = false);
    }, [today]);
    if (recap === null || (recap && !recap.bullets.length)) return null;
    const label = recap ? `What you did ${lastDayName(recap.date, today).replace(/^(Yesterday|Last)/, (w) => w.toLowerCase())}` : "What you did";
    return (
        <Panel label={label} note={recap ? undefined : "summarizing…"}>
            {open && recap && (
                <ul style={{ margin: 0, paddingLeft: 18, listStyle: "disc", display: "flex", flexDirection: "column", gap: 4, fontSize: 13, lineHeight: 1.5, color: T.secondary }}>
                    {recap.bullets.map((b) => (
                        <li key={b}>
                            <Rich text={b} size="full" />
                        </li>
                    ))}
                </ul>
            )}
            {recap && <More open={open} label="Show it, for the daily" onClick={() => setOpen(!open)} />}
        </Panel>
    );
}

function Panel({ label, note, warn, keys, children }: { label: string; note?: string; warn?: boolean; keys?: React.ReactNode; children: React.ReactNode }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px", background: T.card, border: `1px solid ${warn ? T.apricot : T.border}`, borderRadius: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px 14px" }}>
                <span style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", color: T.faint, textTransform: "uppercase" }}>{label}</span>
                    {note && <span style={{ fontFamily: T.mono, fontSize: 10.5, color: warn ? T.apricot : T.muted }}>{note}</span>}
                </span>
                {keys && <span style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>{keys}</span>}
            </div>
            {children}
        </div>
    );
}

function Item({ text, depth, done, carried, carry }: { text: string; depth: number; done?: boolean; carried?: boolean; carry?: () => void }) {
    return (
        <div data-item={carry ? "carry" : undefined} style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "3px 6px", margin: "0 -6px", marginLeft: depth * 20 - 6, borderRadius: 6, fontSize: 13, lineHeight: 1.5, color: done ? T.muted : T.secondary, textDecoration: done ? "line-through" : undefined }}>
            <span style={{ width: 12, height: 12, marginTop: 4, flexShrink: 0, borderRadius: 3, border: `1.5px solid ${done ? T.moss : T.muted}`, background: done ? T.moss : "transparent" }} />
            <span style={{ flexGrow: 1, minWidth: 0, overflowWrap: "anywhere" }}><Rich text={text} size="full" /></span>
            {carried && <span style={{ display: "inline-block", flexShrink: 0, fontFamily: T.mono, fontSize: 10.5, color: T.moss, textDecoration: "none" }}>carried</span>}
            {carry && (
                <button type="button" data-key="c" data-act tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={carry} title="Carry into today" style={{ flexShrink: 0, padding: 0, background: "transparent", border: "none", cursor: "pointer" }}>
                    <Key k="c" label="today" />
                </button>
            )}
        </div>
    );
}

// The workday to scale: meetings, lunch, and the free time between, with now marked.
function Timeline({ now }: { now: number }) {
    const { state } = useWintos();
    const meetings = useMemo(() => meetingsFrom(state?.plugins), [state?.plugins]);
    const { blocks, freeMs, from, to } = dayTimeline(meetings, parseSpan(state?.lunch), new Date(now), parseSpan(state?.workday) ?? DEFAULT_WORKDAY);
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
