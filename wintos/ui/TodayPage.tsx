import { memo, useEffect, useMemo, useState } from "react";
import type { EpicTime } from "../daemon/epics/time";
import type { Session } from "../daemon/sessions/reduce";
import { dayTimeline, DEFAULT_WORKDAY, parseSpan, type Block } from "./dayplan";
import { EpicAvatar } from "./EpicAvatar";
import { agentWorking, lookOf, NO_EPIC, shortName } from "./epicLook";
import { Key } from "./Key";
import { meetingsFrom } from "./meetings";
import { openEpic } from "./menu";
import { shownState } from "./sessions";
import { T } from "./tokens";
import { sessionName, type EpicView } from "./view";
import { useFocusOnMount } from "./useFocusOnMount";
import { useNow } from "./useNow";
import { daemonFetch, useWintos } from "./useWintos";
import { Standup } from "./Standup";
import { useZoneKeys } from "./zones";
import { cursorKeys, startCursor } from "./itemCursor";

const hm = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
const span = (ms: number) => {
    const m = Math.round(ms / 60_000);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ""}`;
};

// ⇧⌘Y: the epics home. The day drawn to scale (meetings, lunch, the free time left), what you
// did on the last worked day for the daily, a card for each open epic (what waits on you there,
// its sessions and planned steps, the first line of its mine.md) and the month's time by epic,
// for the project report. ⏎ on a card opens the epic's page.
export const TodayPage = memo(() => {
    const ref = useFocusOnMount<HTMLDivElement>();
    const { state } = useWintos();
    const now = useNow(30_000);
    const day = state?.day;
    const live = (state?.sessions ?? []).filter((s) => s.state !== "ended" && !s.background);
    // What waits on you first, then what is at work, then the rest by how many sessions are open.
    const weight = (id: string) => {
        const here = live.filter((s) => s.epic === id);
        return (here.some((s) => shownState(s, now) === "waiting") ? 1000 : 0) + (here.some((s) => shownState(s, now) === "working") ? 100 : 0) + here.length;
    };
    const epics = (state?.epics ?? []).filter((e) => !e.done).sort((a, b) => weight(b.id) - weight(a.id));
    useEffect(() => {
        if (ref.current) requestAnimationFrame(() => ref.current && startCursor(ref.current, (el) => el.dataset.item === "link"));
    }, [epics.length > 0]);
    const [back, setBack] = useState(0);
    useZoneKeys(ref, {
        ...cursorKeys(() => ref.current),
        "[": () => (setBack((b) => b + 1), true),
        "]": () => (setBack((b) => Math.max(0, b - 1)), true),
        e: () => {
            const b = ref.current?.querySelector<HTMLElement>("[data-edit-daily]");
            b?.click();
            return !!b;
        },
        c: () => {
            const b = ref.current?.querySelector<HTMLElement>("[data-wintos=month-copy]");
            b?.click();
            return !!b;
        },
    });
    const date = new Date(now);
    const today = day?.date ?? localIso(date);
    // The daily's "Today" line: the steps under way, by epic.
    const plan = epics.flatMap((e) => live.filter((s) => s.epic === e.id).map((s) => `- [ ] ${shortName(e)}: ${sessionName(s)}`)).join("\n");
    return (
        <div ref={ref} tabIndex={0} data-zone="list" data-wintos="today" style={{ flexGrow: 1, display: "flex", flexDirection: "column", gap: 16, padding: "18px 26px 0", background: T.ground, outline: "none", fontFamily: T.ui, minWidth: 0, minHeight: 0 }}>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <h1 style={{ margin: 0, fontFamily: T.display, fontSize: 30, fontWeight: 400, lineHeight: 1, color: T.emphasis }}>{date.toLocaleDateString("en-GB", { weekday: "long" })}</h1>
                    <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.muted }}>{date.toLocaleDateString("en-GB", { day: "numeric", month: "long" })} · {epics.length} epic{epics.length === 1 ? "" : "s"} open</span>
                </div>
                <Key k="esc" label="back" />
            </div>
            <div style={{ flexGrow: 1, minHeight: 0, display: "grid", gridTemplateColumns: "clamp(220px, 26vw, 400px) minmax(0, 820px)", gap: 20, paddingBottom: 18 }}>
                <Timeline now={now} />
                <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0, overflowY: "auto" }}>
                    {day && <Standup today={today} focus={plan} panel={(p) => <Panel {...p} />} />}
                    <Panel label="Epics" note={epics.length ? undefined : "none yet: ⌥⌘E in a session starts one"} keys={epics.length > 0 && <Key k="j k · ⏎" label="open its page" />}>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 10 }}>
                            {epics.map((e) => <EpicCard key={e.id} epic={e} sessions={live.filter((s) => s.epic === e.id)} now={now} />)}
                        </div>
                    </Panel>
                    <MonthByEpic now={now} back={back} />
                </div>
            </div>
        </div>
    );
});
TodayPage.displayName = "TodayPage";

const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function EpicCard({ epic, sessions, now }: { epic: EpicView; sessions: Session[]; now: number }) {
    const look = lookOf(epic);
    const waiting = sessions.filter((s) => shownState(s, now) === "waiting").length;
    const working = sessions.filter((s) => shownState(s, now) === "working").length;
    const state = waiting ? `${waiting} waiting on you` : working ? `${working} at work` : sessions.length ? "quiet" : "no session open";
    const planned = epic.steps.filter((x) => x.state !== "done").map((x) => x.name);
    return (
        <div data-item="link" data-epic={epic.id} style={{ display: "flex", flexDirection: "column", gap: 8, padding: "11px 13px", borderRadius: 10, background: T.sidebar, border: `1px solid ${T.border}`, borderTop: `3px solid ${look.fg}` }}>
            <button type="button" data-act tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => openEpic(epic.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: 0, background: "transparent", border: "none", cursor: "pointer", textAlign: "left", fontFamily: T.ui }}>
                <EpicAvatar look={look} size={28} running={agentWorking(epic, sessions)} />
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: T.emphasis, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortName(epic)}</span>
                    <span style={{ fontSize: 12, color: waiting ? T.apricot : working ? T.moss : T.muted }}>{state}</span>
                </span>
            </button>
            {[...sessions.map((s) => ({ key: s.id, mark: "▸", text: sessionName(s) })), ...planned.map((p) => ({ key: `p:${p}`, mark: "○", text: p }))].slice(0, 4).map((x) => (
                <span key={x.key} style={{ fontSize: 12.5, color: T.secondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <span style={{ fontFamily: T.mono, color: T.faint }}>{x.mark}</span> {x.text}
                </span>
            ))}
            {epic.mineFirst && <span data-wintos="card-mine" style={{ fontSize: 11.5, color: T.faint, borderTop: `1px solid ${T.border}`, paddingTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>mine.md · {epic.mineFirst}</span>}
        </div>
    );
}

// The month so far by epic: the hours you were at its sessions (daemon/epics/time.ts). c copies
// it as a table for the project report.
// [ and ] step to the month before and back; the report is due for the month just past.
type MonthRow = EpicTime & { prs: number; adjusted: number };
function MonthByEpic({ now, back }: { now: number; back: number }) {
    const { state } = useWintos();
    const first = new Date(new Date(now).getFullYear(), new Date(now).getMonth() - back, 1);
    const month = localIso(first).slice(0, 7);
    const [rows, setRows] = useState<MonthRow[] | undefined>();
    const [copied, setCopied] = useState(false);
    // The row being corrected (⏎ on it): its hours as you say they were.
    const [editing, setEditing] = useState<string | undefined>();
    const [reload, setReload] = useState(0);
    // The month's accepted meetings from the calendar; absent when no calendar is set.
    const [meetings, setMeetings] = useState<number | undefined>();
    useEffect(() => {
        let live = true;
        setMeetings(undefined);
        daemonFetch(`/time/meetings?month=${month}`)
            .then((r) => (r.ok ? r.json() : undefined))
            .then((r) => live && setMeetings(r?.ms), () => undefined);
        return () => void (live = false);
    }, [month]);
    useEffect(() => {
        let live = true;
        daemonFetch(`/time/month?month=${month}`)
            .then((r) => (r.ok ? r.json() : []))
            .then((r) => live && setRows(r), () => live && setRows([]));
        return () => void (live = false);
    }, [month, Math.floor(now / 600_000), reload]);
    const correct = (r: MonthRow, hours: number) => {
        const logged = r.ms - r.adjusted;
        void daemonFetch("/time/adjust", { method: "POST", body: { month, epic: r.epic ?? null, ms: Math.round(hours * 3_600_000) - logged } }).then(() => setReload((n) => n + 1));
        setEditing(undefined);
    };
    const name = (id?: string) => (id ? (state?.epics?.find((e) => e.id === id)?.title ?? id) : "No epic");
    const total = (rows ?? []).reduce((n, r) => n + r.ms, 0);
    const copy = () => {
        const table = ["Epic\tHours\tSessions\tPRs", ...(rows ?? []).map((r) => `${name(r.epic)}\t${(r.ms / 3_600_000).toFixed(1)}\t${r.sessions}\t${r.prs}`), ...(meetings !== undefined ? [`Meetings (calendar)\t${(meetings / 3_600_000).toFixed(1)}\t\t`] : [])].join("\n");
        void navigator.clipboard.writeText(table).then(() => setCopied(true));
    };
    const label = first.toLocaleDateString("en-GB", { month: "long", ...(first.getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" } : {}) });
    return (
        <Panel
            label={`${label} by epic`}
            note={rows?.length ? `${span(total)} at sessions` : "nothing logged"}
            keys={
                <>
                    <Key k="[ ]" label="month" />
                    <Key k="j k · ⏎" label="correct the hours" />
                    {rows && rows.length > 0 && (
                        <button type="button" data-wintos="month-copy" data-key="c" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={copy} style={{ padding: 0, background: "transparent", border: "none", cursor: "pointer" }}>
                            <Key k="c" label={copied ? "copied" : "copy as a table"} />
                        </button>
                    )}
                </>
            }
        >
            {(rows ?? []).map((r) => {
                const e = r.epic ? state?.epics?.find((x) => x.id === r.epic) : undefined;
                return (
                    <div key={r.epic ?? "none"} data-wintos="month-row" data-item="link" data-epic={r.epic ?? ""} style={{ display: "grid", gridTemplateColumns: "22px minmax(0, 1fr) 90px 80px 50px", gap: 10, alignItems: "center", fontSize: 13 }}>
                        <EpicAvatar look={e ? lookOf(e) : NO_EPIC} size={20} />
                        <span style={{ color: T.secondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name(r.epic)}</span>
                        {editing === (r.epic ?? "none") ? (
                            <input
                                autoFocus
                                aria-label="hours"
                                defaultValue={(r.ms / 3_600_000).toFixed(1)}
                                onKeyDown={(ev) => {
                                    ev.stopPropagation();
                                    const h = Number((ev.target as HTMLInputElement).value.replace(",", "."));
                                    if (ev.key === "Enter" && Number.isFinite(h) && h >= 0) ev.preventDefault(), correct(r, h);
                                    if (ev.key === "Escape") ev.preventDefault(), setEditing(undefined);
                                }}
                                style={{ width: 70, justifySelf: "end", padding: "2px 6px", background: T.card, border: `1px solid ${T.borderActive}`, borderRadius: 6, color: T.text, fontFamily: T.mono, fontSize: 12, textAlign: "right" }}
                            />
                        ) : (
                            <button type="button" data-act tabIndex={-1} onMouseDown={(ev) => ev.preventDefault()} onClick={() => setEditing(r.epic ?? "none")} title={r.adjusted ? `logged ${span(r.ms - r.adjusted)}, corrected by you` : "⏎ corrects it"} style={{ justifySelf: "end", padding: 0, background: "transparent", border: "none", cursor: "pointer", fontFamily: T.mono, fontSize: 12, color: T.text }}>
                                {span(r.ms)}{r.adjusted ? " *" : ""}
                            </button>
                        )}
                        <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.muted, textAlign: "right" }}>{r.sessions} session{r.sessions === 1 ? "" : "s"}</span>
                        <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.muted, textAlign: "right" }}>{r.prs} PR{r.prs === 1 ? "" : "s"}</span>
                    </div>
                );
            })}
            {meetings !== undefined && (
                <div data-wintos="month-meetings" style={{ display: "grid", gridTemplateColumns: "22px minmax(0, 1fr) 90px 80px 50px", gap: 10, alignItems: "center", fontSize: 13 }}>
                    <span />
                    <span style={{ color: T.muted }}>Meetings (calendar)</span>
                    <span style={{ justifySelf: "end", fontFamily: T.mono, fontSize: 12, color: T.muted }}>{span(meetings)}</span>
                </div>
            )}
        </Panel>
    );
}

// keys: the panel's own shortcuts, shown on it rather than in a footer.
export function Panel({ label, note, warn, keys, children }: { label: string; note?: string; warn?: boolean; keys?: React.ReactNode; children: React.ReactNode }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px", background: T.card, border: `1px solid ${warn ? T.apricot : T.border}`, borderRadius: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px 14px" }}>
                <span style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.08em", color: T.faint, textTransform: "uppercase" }}>{label}</span>
                    {note && <span style={{ fontFamily: T.mono, fontSize: 11.5, color: warn ? T.apricot : T.muted }}>{note}</span>}
                </span>
                {keys && <span style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>{keys}</span>}
            </div>
            {children}
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
                <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.08em", color: T.faint, textTransform: "uppercase" }}>Your day</span>
                <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.moss }}>{span(freeMs)} free</span>
            </div>
            <div style={{ position: "relative", flexGrow: 1, minHeight: 260, marginLeft: 34, borderLeft: `1px solid ${T.border}` }}>
                {hours.map((h, i) => (
                    <span key={h} style={{ position: "absolute", left: -34, top: pct(h), transform: "translateY(-50%)", fontFamily: T.mono, fontSize: 10.5, color: T.faint }}>{i % 2 === 0 ? hm(h).slice(0, 2) : ""}</span>
                ))}
                {blocks.map((b) => (
                    <TimeBlock key={`${b.kind}${b.start}${b.col ?? ""}`} b={b} top={pct(b.start)} height={`${((b.end - b.start) / (to - from)) * 100}%`} />
                ))}
                {now >= from && now <= to && <span style={{ position: "absolute", left: -3, right: 0, top: pct(now), height: 2, background: T.emphasis }} />}
            </div>
        </div>
    );
}

function TimeBlock({ b, top, height }: { b: Block; top: string; height: string }) {
    // Overlapping meetings split the lane's width between them.
    const cols = b.cols ?? 1;
    const across: React.CSSProperties = cols > 1 ? { left: `calc(6px + (100% - 10px) * ${b.col ?? 0} / ${cols})`, width: `calc((100% - 10px) / ${cols} - 2px)` } : { left: 6, right: 4 };
    const base: React.CSSProperties = { position: "absolute", ...across, top, height, borderRadius: 5, padding: "1px 7px", overflow: "hidden", fontSize: 11, lineHeight: 1.35, boxSizing: "border-box" };
    if (b.kind === "meeting") return <div style={{ ...base, background: T.cardActive, border: `1px solid ${T.borderActive}`, color: T.secondary }}><span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.muted }}>{hm(b.start)} </span>{b.title}</div>;
    if (b.kind === "lunch") return <div style={{ ...base, background: `repeating-linear-gradient(135deg, ${T.card} 0 6px, ${T.sidebar} 6px 12px)`, color: T.faint }}>Lunch</div>;
    return <div style={{ ...base, border: `1px dashed ${T.borderActive}`, color: T.moss, fontFamily: T.mono, fontSize: 10.5 }}>{span(b.end - b.start)} free</div>;
}
