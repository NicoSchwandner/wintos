import { useAtomValue } from "jotai";
import { memo, useEffect, useState } from "react";
import { rank, type Level } from "../daemon/journal/reflection";
import type { ReflectionView } from "../daemon/journal/journal";
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

type View = Omit<ReflectionView, "days"> & { days: { date: string; focus: string; readOut: string[] }[] };

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
        <div ref={ref} tabIndex={0} data-zone="list" data-wintos="reflect" style={{ flexGrow: 1, display: "flex", flexDirection: "column", gap: 16, padding: "18px 26px 0", background: "#1d2021", outline: "none", fontFamily: T.ui, minWidth: 0, minHeight: 0 }}>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <h1 style={{ margin: 0, fontFamily: T.display, fontSize: 30, fontWeight: 400, lineHeight: 1, color: T.emphasis }}>{LABEL[view.level]} reflection</h1>
                    <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.muted }}>{view.title} · {dayName(view.date, { weekday: "long", day: "numeric", month: "long" })} · in your journal</span>
                </div>
                <Key k="esc" label="back" />
            </div>
            <div style={{ flexGrow: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 20, paddingBottom: 18 }}>
                <div data-wintos="reflect-lookback" style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0, overflowY: "auto" }}>
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
