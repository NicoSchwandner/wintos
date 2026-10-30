import { useAtomValue } from "jotai";
import { memo, useEffect, useState } from "react";
import { focusList } from "./dayplan";
import { cursorKeys, startCursor } from "./itemCursor";
import { Key } from "./Key";
import { runKey } from "./menu";
import { Dot } from "./notes/ProjectNotes";
import { Panel } from "./TodayPage";
import { shownState } from "./sessions";
import { T } from "./tokens";
import { useFocusOnMount } from "./useFocusOnMount";
import { useNow } from "./useNow";
import { daemonFetch, useWintos } from "./useWintos";
import { prRef, sessionName } from "./view";
import { WOKE } from "./wakes";
import { useZoneKeys } from "./zones";
import { mainViewAtom } from "./notes/state";

// ⇧⌘E: the day closed on purpose. Every loose end gets a place: a turn waiting on you goes to
// tomorrow's plan (t) or is let go (d), both parking its session; what still runs, and the wakes,
// finish on their own. ⌘⏎ writes tomorrow's plan under today's goals for tomorrow and keeps
// WintOS quiet until the next workday starts.
export const WrapupPage = memo(() => {
    const ref = useFocusOnMount<HTMLDivElement>();
    const { state } = useWintos();
    const now = useNow(30_000);
    const view = useAtomValue(mainViewAtom);
    const [draft, setDraft] = useState<string[] | null>(null);
    const [handled, setHandled] = useState<Record<string, "tomorrow" | "dropped">>({});
    const live = (state?.sessions ?? []).filter((s) => !s.background && !s.restored && s.state !== "ended");
    const title = (tabId: string) => state?.projects.find((p) => p.id === tabId)?.title ?? "Untitled";
    const waiting = live.filter((s) => shownState(s, now) === "waiting");
    const running = live.filter((s) => shownState(s, now) === "working");
    const wakes = Object.values(state?.wakes ?? {});
    const open = state?.day ? focusList(state.day.focus).filter((i) => !i.done && i.depth === 0).map((i) => i.text) : [];
    const plan = draft ?? open;
    useEffect(() => {
        if (ref.current) requestAnimationFrame(() => ref.current && startCursor(ref.current, (el) => el.dataset.item === "loose"));
    }, [view]);
    const line = (s: (typeof live)[number]) => `${title(s.tabId)}: ${s.ask?.text ?? s.outcome?.text ?? sessionName(s)}`;
    const park = (s: (typeof live)[number], reason: string) => daemonFetch(`/blocks/${encodeURIComponent(s.blockId)}/wait?session=${encodeURIComponent(s.id)}`, { method: "POST", body: { reason } });
    const toTomorrow = (s: (typeof live)[number]) => (setDraft([...plan, line(s)]), setHandled({ ...handled, [s.id]: "tomorrow" }), void park(s, "tomorrow's plan"));
    const drop = (s: (typeof live)[number]) => (setHandled({ ...handled, [s.id]: "dropped" }), void park(s, "let go at the day's end"));
    const act = (attr: string) => () => {
        const b = ref.current?.querySelector<HTMLElement>(`[data-cursor] [${attr}]`);
        b?.click();
        return !!b;
    };
    const close = async () => {
        if (plan.length) await daemonFetch("/day/tomorrow", { method: "POST", body: { items: plan } });
        await daemonFetch("/rhythm/close", { method: "POST", body: {} });
        runKey("wrapup");
    };
    useZoneKeys(ref, { ...cursorKeys(() => ref.current), t: act("data-tomorrow"), d: act("data-drop"), "Cmd:Enter": () => void close() });
    const looseLeft = waiting.filter((s) => !handled[s.id]).length;
    return (
        <div ref={ref} tabIndex={0} data-zone="list" data-wintos="wrapup" style={{ flexGrow: 1, display: "flex", flexDirection: "column", gap: 16, padding: "18px 26px", background: T.ground, outline: "none", fontFamily: T.ui, minWidth: 0, minHeight: 0, overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <h1 style={{ margin: 0, fontFamily: T.display, fontSize: 30, fontWeight: 400, lineHeight: 1, color: T.emphasis }}>Close the day</h1>
                    <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.muted }}>every loose end gets a place, then the day is done</span>
                </div>
                <span style={{ display: "flex", gap: 12 }}>
                    <Key k="j k" label="move" />
                    <Key k="t" label="tomorrow" />
                    <Key k="d" label="let go" />
                    <Key k="esc" label="back" />
                </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14, alignItems: "start" }}>
                <Panel label={`Waiting on you · ${looseLeft}`}>
                    {waiting.length === 0 && <span style={{ fontSize: 12, color: T.faint }}>Nothing waits on you.</span>}
                    {waiting.map((s) => (
                        <div key={s.id} data-item={handled[s.id] ? undefined : "loose"} style={{ display: "flex", flexDirection: "column", gap: 3, padding: "6px 8px", margin: "0 -8px", borderRadius: 8, opacity: handled[s.id] ? 0.5 : 1 }}>
                            <span style={{ fontSize: 13, color: T.text, overflowWrap: "anywhere" }}>{line(s)}</span>
                            {handled[s.id] ? (
                                <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.moss }}>{handled[s.id] === "tomorrow" ? "→ tomorrow's plan" : "let go"}</span>
                            ) : (
                                <span style={{ display: "flex", gap: 10 }}>
                                    <button type="button" data-tomorrow data-key="t" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => toTomorrow(s)} style={{ padding: 0, background: "transparent", border: "none", cursor: "pointer" }}><Key k="t" label="tomorrow" /></button>
                                    <button type="button" data-drop data-key="d" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => drop(s)} style={{ padding: 0, background: "transparent", border: "none", cursor: "pointer" }}><Key k="d" label="let go" /></button>
                                </span>
                            )}
                        </div>
                    ))}
                </Panel>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <Panel label={`Still running · ${running.length}`}>
                        {running.length === 0 && <span style={{ fontSize: 12, color: T.faint }}>Nothing runs.</span>}
                        {running.map((s) => (
                            <span key={s.id} style={{ fontSize: 12.5, color: T.secondary }}>{title(s.tabId)} · {sessionName(s)}</span>
                        ))}
                        {running.length > 0 && <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.faint }}>they finish on their own; their replies wait for tomorrow</span>}
                    </Panel>
                    <Panel label={`Wakes set · ${wakes.length}`}>
                        {wakes.length === 0 && <span style={{ fontSize: 12, color: T.faint }}>None.</span>}
                        {state && wakes.map((w) => (
                            <span key={`${w.sessionId}${w.pr}${w.until}`} style={{ fontSize: 12.5, color: T.secondary }}>{prRef(state, w.pr)} {WOKE[w.until]}</span>
                        ))}
                        {wakes.length > 0 && <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.faint }}>they type themselves in; nothing to keep in your head</span>}
                    </Panel>
                </div>
                <Panel label="Tomorrow's plan">
                    {plan.length === 0 && <span style={{ fontSize: 12, color: T.faint }}>Nothing yet: t on a waiting turn puts it here.</span>}
                    {plan.map((item, k) => (
                        <div key={`${k}:${item}`} style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 13, color: T.secondary }}>
                            <Dot />
                            <span style={{ flexGrow: 1, minWidth: 0, overflowWrap: "anywhere" }}>{item}</span>
                            <button type="button" tabIndex={-1} aria-label="Leave out of tomorrow's plan" onMouseDown={(e) => e.preventDefault()} onClick={() => setDraft(plan.filter((_, j) => j !== k))} style={{ padding: 0, background: "transparent", border: "none", color: T.faint, cursor: "pointer", fontSize: 12 }}>✕</button>
                        </div>
                    ))}
                    <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.faint }}>goes under today's goals for tomorrow; tomorrow starts from it</span>
                </Panel>
            </div>
            <button type="button" data-wintos="close-day" data-key="⌘⏎" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => void close()} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "14px 18px", background: T.card, border: `1px solid ${T.moss}`, borderRadius: 12, cursor: "pointer", fontFamily: T.ui, textAlign: "left" }}>
                <span style={{ fontSize: 14, color: T.emphasis }}>{looseLeft ? `${looseLeft} still without a place; closing keeps them for tomorrow.` : "Everything has a place."} WintOS stays quiet until the workday starts.</span>
                <Key k="⌘⏎" label="close the day" />
            </button>
        </div>
    );
});
WrapupPage.displayName = "WrapupPage";
