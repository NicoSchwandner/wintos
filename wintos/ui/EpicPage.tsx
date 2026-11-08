import { useAtomValue } from "jotai";
import { memo, useEffect, useRef, useState } from "react";
import type { EpicTime } from "../daemon/epics/time";
import { EpicAvatar } from "./EpicAvatar";
import { agentWorking, lookOf, shortName } from "./epicLook";
import { globalStore } from "@/app/store/jotaiStore";
import { focusSession, openBackground } from "./focus";
import { runAction, runKey } from "./menu";
import { offerStep } from "./newproject";
import { capStyle, Key } from "./Key";
import { stepSessions as linkedSessions } from "./stepLinks";
import { cursorKeys, startCursor } from "./itemCursor";
import { More } from "./notes/ProjectNotes";
import { Mine } from "./notes/Mine";
import { newStepEpicAtom, openEpicAtom } from "./notes/state";
import { useEpicMine } from "./notes/useNotes";
import { shownState, STATE_WORD } from "./sessions";
import { SESSION_DOT, T } from "./tokens";
import { Panel } from "./TodayPage";
import { useNow } from "./useNow";
import { daemonFetch, useWintos } from "./useWintos";
import { ghPrs, prRef, relTime, sessionName } from "./view";
import { isTextField, useZoneKeys, type KeyTable } from "./zones";

type History = { days: { day: string; ms: number }[]; steps: { sessionId: string; ms: number; last: string; name: string; prs: string[]; live: boolean }[] };
const spent = (ms: number) => (ms < 3_600_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3_600_000).toFixed(1).replace(/\.0$/, "")} h`);

// An epic's page, from its card on the epics home: its sessions (each a step; ⏎ goes to its
// pane), its roadmap (the units its sessions set with wintos unit), its mine.md (⌘E edits it) and its time this month.
// p pins it to the top of the sidebar, to keep it in sight; x marks the epic done, or open again: a done epic leaves the sidebar's picks and stays in the report.
// column: the same, narrow, beside the epic agent's terminal (its view is the epic's view); it
// takes focus only by ⌘L from that terminal, so typing to the agent is never interrupted.
// An action as a button the mouse knows. Its key shows on it on the page; beside the agent's
// terminal (chrome, theme.css) the cap hides and holding ⌘ badges the button instead.
function Act({ k, label, onClick, wintos, primary }: { k: string; label: string; onClick: () => void; wintos: string; primary?: boolean }) {
    return (
        <button type="button" data-wintos={wintos} data-key={k} tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={onClick} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "4px 10px", borderRadius: 7, border: `1px solid ${primary ? T.borderActive : T.border}`, background: primary ? T.cardActive : T.card, cursor: "pointer", fontFamily: T.ui, fontSize: 12.5, color: primary ? T.emphasis : T.secondary, whiteSpace: "nowrap" }}>
            <span className="w-keycap" style={capStyle}>{k}</span>
            {label}
        </button>
    );
}

export const EpicPage = memo(() => <EpicBody id={useAtomValue(openEpicAtom)} />);
EpicPage.displayName = "EpicPage";

export const EpicBody = memo(({ id, column }: { id: string; column?: boolean }) => {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => void (column || ref.current?.focus()), []);
    const { state } = useWintos();
    const now = useNow(30_000);
    const epic = state?.epics?.find((e) => e.id === id);
    const { mine, save } = useEpicMine(epic?.id);
    const [month, setMonth] = useState<EpicTime | undefined>();
    // Its sessions, also those its agent started in the background (wintos start), which no pane shows yet.
    const sessions = (state?.sessions ?? []).filter((s) => s.epic === id && s.state !== "ended" && (!s.background || !!s.bgId));
    const iso = new Date(now).toISOString().slice(0, 7);
    useEffect(() => {
        let live = true;
        daemonFetch(`/time/month?month=${iso}`)
            .then((r) => (r.ok ? r.json() : []))
            .then((r: EpicTime[]) => live && setMonth(r.find((x) => x.epic === id)), () => {});
        return () => void (live = false);
    }, [id, iso]);
    const [history, setHistory] = useState<History | undefined>();
    useEffect(() => {
        let live = true;
        daemonFetch(`/epics/${encodeURIComponent(id)}/history`)
            .then((r) => (r.ok ? r.json() : undefined))
            .then((h) => live && setHistory(h), () => {});
        return () => void (live = false);
    }, [id, Math.floor(now / 300_000)]);
    useEffect(() => {
        if (ref.current) requestAnimationFrame(() => ref.current && (startCursor(ref.current, (el) => el.dataset.unit === "current") || startCursor(ref.current, (el) => el.dataset.item === "link")));
    }, [id]);
    const toggleDone = () => epic && void daemonFetch(`/epics/${encodeURIComponent(epic.id)}/done`, { method: "POST", body: { done: !epic.done } });
    // x finishes the epic only on a second press within 3 s, like every other key that ends
    // something (⌫ ⌫, ⌥⌘R ⌥⌘R); elsewhere x ticks one item. Opening it again needs no second press.
    const [finishing, setFinishing] = useState(false);
    useEffect(() => {
        if (!finishing) return;
        const t = setTimeout(() => setFinishing(false), 3_000);
        return () => clearTimeout(t);
    }, [finishing]);
    const pressX = () => (epic?.done || finishing ? (setFinishing(false), toggleDone()) : setFinishing(true));
    // a: to the epic agent's pane; resumed from the shelf when its pane was closed; else a new
    // one in a view of its own, which knows from its first prompt that it is the epic's agent.
    // To the newest of these sessions that is still open, else resumed from the shelf; false when none is left.
    const goTo = (ids: string[]): boolean => {
        for (const id of [...ids].reverse()) {
            const live = state?.sessions.find((s) => s.id === id && s.state !== "ended");
            if (live?.bgId && !live.attachedTo) return openBackground(live.bgId), true;
            if (live) return focusSession({ tabId: live.tabId, blockId: live.blockId }), true;
            const shelved = Object.entries(state?.shelf ?? {}).flatMap(([tabId, items]) => items.filter((i) => i.sessionId === id).map((i) => ({ tabId, script: i.script })))[0];
            if (shelved) return focusSession({ tabId: shelved.tabId, blockId: "", resume: shelved.script }), true;
        }
        return false;
    };
    const toAgent = () => {
        if (!epic || (epic.agent && goTo([epic.agent]))) return;
        offerStep({ epic: epic.id, step: `${shortName(epic)} agent`, agentOf: epic.id });
        runAction("project");
    };
    // s: a planned step at the end of the roadmap; n: a new session for one, the epic chosen already.
    const [adding, setAdding] = useState(false);
    const [addError, setAddError] = useState("");
    const stopAdding = () => (setAdding(false), setAddError(""), ref.current?.focus());
    const addStep = (name: string) => {
        if (!epic || !name.trim()) return stopAdding();
        void daemonFetch(`/epics/${encodeURIComponent(epic.id)}/roadmap`, { method: "POST", body: { add: name } }).then(async (r) => (r.ok ? stopAdding() : setAddError(await r.text())));
    };
    const newStep = () => epic && (globalStore.set(newStepEpicAtom, epic.id), runKey("new-step"));
    // The roadmap, worked from its rows: ⏎ goes to the session working the step (a done one too), or
    // starts one for it; d done or open again; J K move; e renames; ⌫ twice removes. The epic agent hears of each edit.
    // Finished steps stay folded: what is done is looked up, not read every time.
    const [showFinished, setShowFinished] = useState(false);
    const [renaming, setRenaming] = useState<string | undefined>();
    const [removing, setRemoving] = useState<string | undefined>();
    const [stepError, setStepError] = useState("");
    const edit = (op: object) => epic && void daemonFetch(`/epics/${encodeURIComponent(epic.id)}/roadmap`, { method: "POST", body: op }).then(async (r) => setStepError(r.ok ? "" : await r.text()));
    const openStep = (name: string) => {
        if (!epic || goTo(stepSessions(name))) return;
        offerStep({ epic: epic.id, step: name, unit: name });
        runAction("project");
    };
    // The sessions that work a step (stepLinks.ts); never the agent, whose pane is where you are
    // when you work the roadmap beside it.
    const stepSessions = (name: string) => (epic ? linkedSessions(name, epic.links?.[name] ?? [], state?.sessions ?? [], epic) : []);
    const stepAtCursor = () => ref.current?.querySelector<HTMLElement>("[data-cursor][data-step]")?.dataset.step;
    const onStep = (f: (name: string) => void) => () => {
        const name = stepAtCursor();
        if (name === undefined) return false;
        if (removing && removing !== name) setRemoving(undefined);
        return f(name), true;
    };
    // r: the epic's title and short name, edited in place; ⏎ in either field keeps both, esc leaves them.
    const [retitling, setRetitling] = useState(false);
    const titleRef = useRef<HTMLInputElement>(null);
    const shortRef = useRef<HTMLInputElement>(null);
    const retitle = () => {
        if (epic && titleRef.current?.value.trim()) void daemonFetch(`/epics/${encodeURIComponent(epic.id)}/title`, { method: "POST", body: { title: titleRef.current.value, short: shortRef.current?.value ?? "" } });
        setRetitling(false);
        ref.current?.focus();
    };
    const togglePin = () => epic && void daemonFetch(`/epics/${encodeURIComponent(epic.id)}/pin`, { method: "POST", body: { pinned: !epic.pinned } });
    // Enter and ⌫ reach this table from the page's own fields too; there they belong to the field.
    const cursor = cursorKeys(() => ref.current);
    const notInField = (run: KeyTable[string]): KeyTable[string] => (e) => (isTextField(document.activeElement) ? false : run(e));
    useZoneKeys(ref, { ...cursor, Enter: notInField(cursor.Enter), x: () => (pressX(), true), p: () => (togglePin(), true), r: () => (setRetitling(true), true), a: () => (toAgent(), true), s: () => (setAdding(true), true), n: () => (newStep(), true),
        d: onStep((name) => edit({ done: name, on: epic?.steps.find((u) => u.name === name)?.state !== "done" })),
        // The cursor goes along with the step it moves.
        "Shift:j": (e) => onStep((name) => (edit({ move: { name, by: 1 } }), cursor.j(e)))(),
        "Shift:k": (e) => onStep((name) => (edit({ move: { name, by: -1 } }), cursor.k(e)))(),
        e: onStep((name) => setRenaming(name)),
        Backspace: notInField(onStep((name) => (removing === name ? (edit({ remove: name }), setRemoving(undefined)) : setRemoving(name)))),
    });
    if (!epic) return column ? null : <div ref={ref} tabIndex={0} data-zone="list" style={{ flexGrow: 1, padding: 26, color: T.muted, fontFamily: T.ui, outline: "none" }}>That epic is gone.</div>;
    const look = lookOf(epic);
    const roadmap = epic.steps;
    const finished = (history?.steps ?? []).filter((x) => !x.live);
    const peak = Math.max(1, ...(history?.days ?? []).map((d) => d.ms));
    const gh = state ? ghPrs(state) : undefined;
    const prUrls = [...new Set([...sessions.flatMap((x) => x.prs ?? []), ...(history?.steps ?? []).flatMap((x) => x.prs)])];
    const prs = prUrls.map((url) => {
        const p = gh?.prs.find((x) => x.url === url);
        return { url, ref: state ? prRef(state, url) : url, title: p?.title, state: p ? (p.mergedAt ? "merged" : p.isDraft ? "draft" : "open") : "closed or merged" };
    });
    // Beside the agent the roadmap has the left column to itself; these go right, with the rest.
    const finishedPanel = (
        <Panel label="Finished sessions" note={finished.length ? `${finished.length} · ${spent(finished.reduce((n, f) => n + f.ms, 0))} at them` : "none yet"}>
            {finished.length > 0 && <More open={showFinished} label={`Show the ${finished.length} finished`} onClick={() => setShowFinished((v) => !v)} />}
            {showFinished && finished.map((f) => (
                <div key={f.sessionId} data-wintos="finished-step" style={{ display: "grid", gridTemplateColumns: "14px minmax(0, 1fr) auto auto", gap: 10, alignItems: "baseline", fontSize: 13, color: T.secondary }}>
                    <span style={{ fontFamily: T.mono, color: T.moss }}>✓</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                    <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.faint }}>{f.prs.map((u) => (state ? prRef(state, u) : u)).join(" · ")}</span>
                    <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.muted }}>{spent(f.ms)} · {f.last.slice(5)}</span>
                </div>
            ))}
        </Panel>
    );
    const sessionsPanel = (
        <Panel label="Sessions" note={shortName(epic)} keys={sessions.length > 0 && <Key k="j k · ⏎" label="its pane" />}>
            {sessions.map((s) => {
                const shown = shownState(s, now);
                return (
                    <div key={s.id} data-item="link" data-session={s.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <button type="button" data-act tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => (s.bgId && !s.attachedTo ? openBackground(s.bgId) : focusSession({ tabId: s.tabId, blockId: s.blockId }))} style={{ display: "flex", alignItems: "center", gap: 10, flexGrow: 1, minWidth: 0, padding: "4px 6px", margin: "0 -6px", borderRadius: 6, background: "transparent", border: "none", cursor: "pointer", textAlign: "left", fontFamily: T.ui, fontSize: 13.5, color: T.text }}>
                            <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: SESSION_DOT[shown] }} />
                            <span style={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sessionName(s)}</span>
                            <span style={{ fontFamily: T.mono, fontSize: 11.5, color: shown === "waiting" ? T.apricot : T.muted }}>{s.bgId && !s.attachedTo ? "background · " : ""}{STATE_WORD[shown]} {relTime(now - s.since)}</span>
                        </button>
                    </div>
                );
            })}
            {!sessions.length && <span style={{ fontSize: 12.5, color: T.faint }}>No session in it now. n starts one.</span>}
        </Panel>
    );
    return (
        <div
            ref={ref}
            tabIndex={0}
            data-zone="list"
            data-wintos={column ? "epic-column" : "epic-page"}
            data-epic={epic.id}
            className={column ? "wintos-steps-side w-epic-col" : undefined}
            style={column ? { flexShrink: 0, display: "flex", flexDirection: "column", gap: 12, padding: "10px 12px", borderLeft: `1px solid ${T.border}`, background: T.ground, outline: "none", fontFamily: T.ui, minHeight: 0, overflowY: "auto" } : { flexGrow: 1, display: "flex", flexDirection: "column", gap: 16, padding: "18px 26px 18px", background: T.ground, outline: "none", fontFamily: T.ui, minWidth: 0, minHeight: 0, overflowY: "auto" }}
        >
            <div style={{ display: "flex", alignItems: "center", gap: column ? 10 : 16, flexWrap: "wrap", padding: column ? "8px 10px" : "14px 16px", borderRadius: 12, background: `linear-gradient(90deg, ${look.bg} 0%, transparent 70%)`, borderTop: `3px solid ${look.fg}` }}>
                <EpicAvatar look={look} size={column ? 30 : 56} running={agentWorking(epic, state?.sessions)} />
                <div style={{ display: "flex", flexDirection: "column", gap: 4, flexGrow: 1, minWidth: 0 }}>
                    {retitling ? (
                        <span data-wintos="epic-retitle" style={{ display: "flex", gap: 6, flexWrap: "wrap" }} onKeyDown={(ev) => {
                            ev.stopPropagation();
                            if (ev.key === "Enter") ev.preventDefault(), retitle();
                            if (ev.key === "Escape") ev.preventDefault(), setRetitling(false), ref.current?.focus();
                        }}>
                            <input ref={titleRef} autoFocus aria-label="the epic's title" placeholder="title" defaultValue={epic.title} maxLength={80} style={{ flex: "1 1 220px", minWidth: 0, padding: "2px 8px", background: T.card, border: `1px solid ${T.borderActive}`, borderRadius: 6, outline: "none", color: T.emphasis, fontFamily: T.display, fontSize: column ? 16 : 22 }} />
                            <input ref={shortRef} aria-label="its short name, for the sidebar" placeholder="short name (optional)" defaultValue={epic.short ?? ""} maxLength={20} style={{ flex: "0 1 150px", minWidth: 0, padding: "2px 8px", background: T.card, border: `1px solid ${T.border}`, borderRadius: 6, outline: "none", color: T.text, fontFamily: T.ui, fontSize: 13 }} />
                        </span>
                    ) : (
                        <h1 style={{ margin: 0, fontFamily: T.display, fontSize: column ? 18 : 30, fontWeight: 400, lineHeight: 1.1, color: T.emphasis }}>{column ? shortName(epic) : epic.title}</h1>
                    )}
                    <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.muted }}>
                        {[epic.done ? `done ${epic.done}` : `${sessions.length} session${sessions.length === 1 ? "" : "s"} open`, month && month.ms >= 60_000 && `${spent(month.ms)} this month`, epic.lane && `${epic.lane} sessions land here`].filter(Boolean).join(" · ")}
                    </span>
                </div>
                <span style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    {column && <Key k="⌘L ⌘H" label="into the epic · back to the agent" hold />}
                    {!column && <Act wintos="epic-agent" k="a" label={epic.agent ? "Epic agent" : "Start the epic agent"} onClick={toAgent} primary />}
                    <Act wintos="epic-rename" k="r" label="Rename" onClick={() => setRetitling(true)} />
                    <Act wintos="epic-pin" k="p" label={epic.pinned ? "Unpin" : "Pin"} onClick={togglePin} />
                    <Act wintos="epic-done" k="x" label={epic.done ? "Open again" : finishing ? "x again: finish the epic" : "Epic done"} onClick={toggleDone} />
                    {!column && <Key k="esc" label="back" />}
                </span>
            </div>
            <div className={column ? "w-epic-grid" : undefined} style={{ display: "grid", gridTemplateColumns: column ? undefined : "minmax(0, 1fr) minmax(260px, 360px)", gap: column ? 12 : 20, alignItems: "start" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <Panel
                        label="Roadmap"
                        note={roadmap.length ? `${roadmap.filter((u) => u.state === "done").length} of ${roadmap.length} done` : "none yet: s adds a step, or the epic agent sets it"}
                        keys={
                            <>
                                {roadmap.length > 0 && <Key k="⏎ d ⇧J ⇧K e ⌫" label="go or start · done · move · rename · remove" hold={column} />}
                                <Act wintos="epic-add-step" k="s" label="Add step" onClick={() => setAdding(true)} />
                                <Act wintos="epic-start-step" k="n" label="New session" onClick={newStep} primary />
                            </>
                        }
                    >
                        <div data-wintos="epic-roadmap" style={{ display: "flex", flexDirection: "column", gap: 2, margin: "0 -9px" }}>
                            {roadmap.map((u) => {
                                const ids = stepSessions(u.name);
                                const live = (state?.sessions ?? []).filter((x) => ids.includes(x.id) && x.state !== "ended");
                                const worked = (history?.steps ?? []).filter((x) => ids.includes(x.sessionId));
                                const ms = worked.reduce((n, x) => n + x.ms, 0);
                                const refs = [...new Set(worked.flatMap((x) => x.prs))].map((url) => (state ? prRef(state, url) : url));
                                const shown = live[0] && shownState(live[0], now);
                                const tail = [shown && `● ${STATE_WORD[shown]}`, ms >= 60_000 && spent(ms), refs.join(" · ")].filter(Boolean).join(" · ");
                                return (
                                    <div key={u.name} data-item="link" data-step={u.name} data-unit={u.state} style={{ display: "grid", gridTemplateColumns: "12px minmax(0, 1fr) auto", gap: 10, alignItems: "baseline", padding: "6px 9px", borderRadius: 8, background: u.state === "current" ? T.cardActive : "transparent", boxShadow: u.state === "current" ? `inset 3px 0 0 ${look.fg}` : undefined, fontSize: 14.5, lineHeight: 1.35, color: u.state === "current" ? T.emphasis : u.state === "done" ? T.faint : T.text, fontWeight: u.state === "current" ? 600 : 400 }}>
                                        <span style={{ fontFamily: T.mono, color: u.state === "todo" ? T.faint : T.moss }}>{u.state === "done" ? "✓" : u.state === "current" ? "▸" : "○"}</span>
                                        {renaming === u.name ? (
                                            <input
                                                autoFocus
                                                data-wintos="epic-step-rename"
                                                aria-label="rename the step"
                                                defaultValue={u.name}
                                                maxLength={80}
                                                onKeyDown={(ev) => {
                                                    ev.stopPropagation();
                                                    const done = () => (setRenaming(undefined), ref.current?.focus());
                                                    if (ev.key === "Enter") ev.preventDefault(), edit({ rename: { from: u.name, to: (ev.target as HTMLInputElement).value } }), done();
                                                    if (ev.key === "Escape") ev.preventDefault(), done();
                                                }}
                                                style={{ padding: "1px 6px", background: T.card, border: `1px solid ${T.borderActive}`, borderRadius: 6, outline: "none", color: T.text, fontFamily: T.ui, fontSize: 13.5 }}
                                            />
                                        ) : (
                                            <button type="button" data-act tabIndex={-1} onMouseDown={(ev) => ev.preventDefault()} onClick={() => openStep(u.name)} title={live.length ? "⏎ its session" : ids.length ? "⏎ resumes its session" : "⏎ starts a session for it"} style={{ padding: 0, background: "transparent", border: "none", cursor: "pointer", textAlign: "left", font: "inherit", color: "inherit", textDecoration: u.state === "done" ? "line-through" : undefined, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                {u.name}
                                            </button>
                                        )}
                                        <span style={{ gridColumn: "2 / 4", fontFamily: T.mono, fontSize: 11, fontWeight: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: removing === u.name ? T.apricot : shown === "waiting" ? T.apricot : T.muted, display: tail || removing === u.name ? undefined : "none" }}>{removing === u.name ? "⌫ again removes it" : tail}</span>
                                    </div>
                                );
                            })}
                            {adding && (
                                <input
                                    autoFocus
                                    data-wintos="epic-step-input"
                                    aria-label="a planned step"
                                    placeholder="a planned step, a few words · ⏎ adds it · esc cancels"
                                    maxLength={80}
                                    onKeyDown={(ev) => {
                                        ev.stopPropagation();
                                        if (ev.key === "Enter") ev.preventDefault(), addStep((ev.target as HTMLInputElement).value);
                                        if (ev.key === "Escape") ev.preventDefault(), stopAdding();
                                    }}
                                    style={{ padding: "4px 8px", background: T.card, border: `1px solid ${T.borderActive}`, borderRadius: 6, outline: "none", color: T.text, fontFamily: T.ui, fontSize: 13.5 }}
                                />
                            )}
                            {(addError || stepError) && <span style={{ fontSize: 12, color: T.apricot }}>{addError || stepError}</span>}
                        </div>
                    </Panel>
                    {!column && finishedPanel}
                    {!column && sessionsPanel}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {column && sessionsPanel}
                {column && finishedPanel}
                <Panel label="Last 8 workdays" note={history ? spent(history.days.reduce((n, d) => n + d.ms, 0)) : "…"}>
                    <div data-wintos="epic-days" style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 90 }}>
                        {(history?.days ?? []).map((d) => (
                            <div key={d.day} title={`${d.day}: ${spent(d.ms)}`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, height: "100%", justifyContent: "flex-end" }}>
                                <span style={{ width: "100%", height: `${Math.max(2, (d.ms / peak) * 70)}px`, borderRadius: "3px 3px 0 0", background: d.day === history!.days.at(-1)!.day ? look.fg : look.ring }} />
                                <span style={{ fontFamily: T.mono, fontSize: 10, color: T.faint }}>{d.day.slice(8)}</span>
                            </div>
                        ))}
                    </div>
                </Panel>
                <Panel label="PRs" note={prs.length ? undefined : "none yet"}>
                    {prs.map((p) => (
                        // In a WintOS pane like every other PR, in the header's colours (open aqua, merged purple).
                        <button key={p.url} type="button" data-wintos="epic-pr" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => runAction(`open-page:${p.url}`)} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: 0, fontSize: 12.5, color: T.secondary, background: "transparent", border: "none", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.ref}{p.title ? ` · ${p.title}` : ""}</span>
                            <span style={{ fontFamily: T.mono, fontSize: 11, color: p.state === "merged" ? T.purple : p.state === "open" ? T.aqua : T.faint, flexShrink: 0 }}>{p.state}</span>
                        </button>
                    ))}
                </Panel>
                {!column && (
                    <Panel label="mine.md" note="every session in the epic reads it" keys={<Key k="⌘E" label="edit" />}>
                        <Mine text={mine?.text ?? ""} mtime={mine?.mtime ?? 0} canEdit={!!mine} save={save} size="full" draftKey={`epic-mine:${epic.id}`} file={`${shortName(epic)}'s mine.md`} empty="Empty. Press ⌘E to write what every session in this epic must respect." />
                    </Panel>
                )}
                </div>
            </div>
        </div>
    );
});
EpicBody.displayName = "EpicBody";
