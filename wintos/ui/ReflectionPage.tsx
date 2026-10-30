import { useAtomValue } from "jotai";
import { memo, useEffect, useState } from "react";
import { rank, type Level } from "../daemon/journal/reflection";
import type { ReflectionView } from "../daemon/journal/journal";
import type { DayNumbers } from "../daemon/recap/numbers";
import { editMine } from "./focus";
import { Key } from "./Key";
import { Md } from "./notes/Md";
import { Mine } from "./notes/Mine";
import { editingMineAtom } from "./notes/state";
import type { SaveResult } from "./notes/useNotes";
import { Panel } from "./TodayPage";
import { T } from "./tokens";
import { useFocusOnMount } from "./useFocusOnMount";
import { daemonFetch, useWintos } from "./useWintos";
import { useZoneKeys } from "./zones";

type View = Omit<ReflectionView, "days"> & { days: { date: string; focus: string; readOut: string[]; numbers?: DayNumbers }[] };

const dayName = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", opts);
const LABEL: Record<Level, string> = { weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" };

// ⌥⌘Y: the reflection the journal's tool put on a Friday, written here beside what it looks back
// on: a weekly beside its days, a monthly beside its weeklies, and so on up. Nothing is drafted
// for you; the look-back is only what you wrote or read out at the time.
export const ReflectionPage = memo(() => {
    const ref = useFocusOnMount<HTMLDivElement>();
    const { state } = useWintos();
    const editing = useAtomValue(editingMineAtom);
    const [view, setView] = useState<View | null | undefined>();
    const [reloads, setReloads] = useState(0);
    const journalChanged = state?.day?.mtime;
    useEffect(() => {
        let live = true;
        daemonFetch(`/reflection${view ? `?date=${view.date}` : ""}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((r) => live && setView(r), () => live && setView(null));
        return () => void (live = false);
    }, [reloads, journalChanged]);
    useZoneKeys(ref, view ? { "Cmd:e": () => editMine(true) } : {});
    const save = async (text: string, baseMtime: number): Promise<SaveResult> => {
        try {
            const r = await daemonFetch("/reflection", { method: "POST", body: { date: view!.date, body: text, baseMtime } });
            if (r.ok) setReloads((n) => n + 1);
            return r.ok ? "ok" : r.status === 409 ? "conflict" : "error";
        } catch {
            return "error";
        }
    };
    if (!view) {
        return (
            <div ref={ref} tabIndex={0} data-zone="list" data-wintos="reflect" style={{ flexGrow: 1, padding: 26, fontFamily: T.ui, color: T.muted, outline: "none" }}>
                {view === null ? "No reflection in your journal yet: a Friday made by your journal's own tool (WINTOS_JOURNAL_NEW) carries one." : ""}
            </div>
        );
    }
    // The level just below leads (a quarterly's monthlies), the ones under it follow.
    const earlier = [...view.earlier].sort((a, b) => rank(b.level) - rank(a.level) || b.date.localeCompare(a.date));
    return (
        <div ref={ref} tabIndex={0} data-zone="list" data-wintos="reflect" style={{ flexGrow: 1, display: "flex", flexDirection: "column", gap: 16, padding: "18px 26px 0", background: T.ground, outline: "none", fontFamily: T.ui, minWidth: 0, minHeight: 0 }}>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <h1 style={{ margin: 0, fontFamily: T.display, fontSize: 30, fontWeight: 400, lineHeight: 1, color: T.emphasis }}>{LABEL[view.level]} reflection</h1>
                    <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.muted }}>{view.title} · {dayName(view.date, { weekday: "long", day: "numeric", month: "long" })} · in your journal</span>
                </div>
                <Key k="esc" label="back" />
            </div>
            <div style={{ flexGrow: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 20, paddingBottom: 18 }}>
                <div data-wintos="reflect-lookback" style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0, overflowY: "auto" }}>
                    <WeekNumbers days={view.days} />
                    {view.goals && (
                        <Panel label={`The goals you set ${dayName(view.goals.date, { day: "numeric", month: "long" })}`}>
                            <Md text={view.goals.items.join("\n")} size="full" />
                        </Panel>
                    )}
                    {view.days.length > 0 && (
                        <Panel label="Your week">
                            {view.days.map((d) => (
                                <div key={d.date} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                    <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.muted }}>{dayName(d.date, { weekday: "long", day: "numeric", month: "short" })}</span>
                                    {d.focus ? <Md text={d.focus} size="full" /> : <span style={{ fontSize: 12, color: T.faint }}>Nothing planned.</span>}
                                    {d.readOut.length > 0 && <Md text={d.readOut.map((t) => `- ${t}`).join("\n")} size="full" />}
                                </div>
                            ))}
                        </Panel>
                    )}
                    {earlier.map((e) => (
                        <Panel key={e.date} label={`${LABEL[e.level]} · ${dayName(e.date, { day: "numeric", month: "long" })}`} note={e.answers ? undefined : "not written"}>
                            {e.answers && <Md text={e.answers} size="full" />}
                        </Panel>
                    ))}
                    {!view.goals && !view.days.length && !view.earlier.length && <span style={{ fontSize: 12.5, color: T.faint }}>Nothing to look back on yet.</span>}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0, overflowY: "auto" }}>
                    <Panel label="Your reflection" keys={editing ? <><Key k="⌘⏎" label="save" /><Key k="esc" label="discard" /></> : <Key k="⌘E" label="write" />}>
                        <Mine text={view.body} mtime={view.mtime} canEdit save={save} size="full" file="the reflection's journal file" />
                    </Panel>
                </div>
            </div>
        </div>
    );
});
ReflectionPage.displayName = "ReflectionPage";

const LATE_HOUR = 20;
const hm = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const span = (ms: number) => (ms >= 3_600_000 ? `${Math.floor(ms / 3_600_000)} h ${String(Math.round((ms % 3_600_000) / 60_000)).padStart(2, "0")}` : `${Math.round(ms / 60_000)} min`);

// The week as it went, from your prompts: plain numbers, no score. The longest stretch without a
// break per day is the one to watch: over an hour shows in apricot.
function WeekNumbers({ days }: { days: View["days"] }) {
    const worked = days.filter((d) => d.numbers);
    if (!worked.length) return null;
    const n = (d: View["days"][number]) => d.numbers!;
    const longest = worked.reduce((a, b) => (n(b).longestMs > n(a).longestMs ? b : a));
    const late = worked.filter((d) => new Date(n(d).lastAt).getHours() >= LATE_HOUR);
    const switchPct = Math.round(worked.reduce((k, d) => k + n(d).switchPct, 0) / worked.length);
    const max = Math.max(...worked.map((d) => n(d).longestMs), 3_600_000);
    const tile = (label: string, value: string, note: string, tone?: string) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 11, color: T.muted }}>{label}</span>
            <span style={{ fontFamily: T.display, fontSize: 28, lineHeight: 1.1, color: tone ?? T.emphasis }}>{value}</span>
            <span style={{ fontFamily: T.mono, fontSize: 10, color: T.faint }}>{note}</span>
        </div>
    );
    return (
        <Panel label="The week in numbers">
            <div data-wintos="week-numbers" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
                {tile("Longest without a break", span(n(longest).longestMs), dayName(longest.date, { weekday: "long" }), n(longest).longestMs > 3_600_000 ? T.apricot : undefined)}
                {tile("Next prompt elsewhere", `${switchPct}%`, "of prompts, on average")}
                {tile(`Evenings past ${LATE_HOUR}:00`, `${late.length} of ${worked.length}`, late.map((d) => `${dayName(d.date, { weekday: "short" })} ${hm(n(d).lastAt)}`).join(" · ") || "none")}
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 110, paddingTop: 8 }}>
                {days.map((d) => (
                    <div key={d.date} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 0 }}>
                        <span style={{ fontFamily: T.mono, fontSize: 10, color: T.secondary }}>{d.numbers ? span(d.numbers.longestMs) : ""}</span>
                        <span style={{ width: "100%", height: d.numbers ? Math.max(3, (70 * d.numbers.longestMs) / max) : 0, borderRadius: "4px 4px 0 0", background: (d.numbers?.longestMs ?? 0) > 3_600_000 ? T.apricot : T.moss }} />
                    </div>
                ))}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
                {days.map((d) => (
                    <span key={d.date} style={{ flex: 1, textAlign: "center", fontSize: 11, color: T.muted, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {dayName(d.date, { weekday: "short" })}{d.numbers ? ` · ${d.numbers.sessions}` : ""}
                    </span>
                ))}
            </div>
            <span style={{ fontFamily: T.mono, fontSize: 10, color: T.faint }}>longest stretch without a 10-minute gap, per day · sessions you prompted · breaks of 20 min: {worked.reduce((k, d) => k + n(d).breaks, 0)}</span>
        </Panel>
    );
}
