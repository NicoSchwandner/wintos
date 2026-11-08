import type { Row } from "../daemon/ranking/rank";
import { EpicAvatar } from "./EpicAvatar";
import { lookOf, NO_EPIC, shortName } from "./epicLook";
import { openBackground } from "./focus";
import { openEpic } from "./menu";
import { STATE_WORD } from "./sessions";
import { sessionName } from "./view";
import type { Session } from "../daemon/sessions/reduce";
import { ACTIVE, SESSION_DOT, T } from "./tokens";
import type { EpicView } from "./view";

// agent: the epic agent's own row, shown as the epic's header rather than as a row under it:
// going to the epic and going to its agent are the same.
export type EpicGroup = { epic?: EpicView; rows: Row[]; agent?: Row };

// The sidebar: each open epic with its sessions under it, in an order that holds still: pinned
// epics first, then by name. What needs you is found by ⌃⇥, not by epics jumping around.
// Sessions in no epic, and tabs without a session, come last. Rows keep the state list's order.
export function groupByEpic(rows: Row[], epics: EpicView[]): EpicGroup[] {
    const open = epics.filter((e) => !e.done);
    const of = (r: Row) => (r.key !== r.tabId ? r.sessions[0]?.epic : undefined);
    const isAgent = (r: Row, e: EpicView) => !!e.agent && r.key === `s:${e.agent}`;
    const groups = open.map((epic) => ({ epic, rows: rows.filter((r) => of(r) === epic.id && !isAgent(r, epic)), agent: rows.find((r) => isAgent(r, epic)) }));
    groups.sort((a, b) => Number(!!b.epic.pinned) - Number(!!a.epic.pinned) || shortName(a.epic).localeCompare(shortName(b.epic), undefined, { sensitivity: "base" }));
    const known = new Set(open.map((e) => e.id));
    const agents = new Set(groups.flatMap((g) => (g.agent ? [g.agent.key] : [])));
    const loose = rows.filter((r) => (!of(r) || !known.has(of(r)!)) && !agents.has(r.key));
    return [...groups, ...(loose.length ? [{ rows: loose }] : [])];
}

// background: sessions the agents started in the background (no pane, so no row): listed under
// their epic, a click opens one in a pane.
export function EpicGroups({ groups, renderRow, isHere = () => false, cursor, newStep, background = [] }: { groups: EpicGroup[]; renderRow: (r: Row) => React.ReactNode; isHere?: (r: Row) => boolean; cursor: string | null; newStep: (epic: string) => void; background?: Session[] }) {
    // An epic with nothing under it (Reviews, Elmah between errands) folds to one line, kept apart
    // at the bottom.
    const bgOf = (g: EpicGroup) => (g.epic ? background.filter((s) => s.epic === g.epic!.id) : []);
    const empty = (g: EpicGroup) => !!g.epic && !g.rows.length && !bgOf(g).length && g.agent?.band !== "needs" && !(g.agent && isHere(g.agent));
    const header = (g: EpicGroup, folded: boolean) => {
        const look = lookOf(g.epic!);
        const waiting = g.rows.filter((r) => r.band === "needs").length;
        // In the agent's pane, its heading is where you are: lit like a focused row.
        const here = !!g.agent && isHere(g.agent);
        return (
            <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                <button
                    type="button"
                    data-row={`epic:${g.epic!.id}`}
                    data-on={here || undefined}
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => openEpic(g.epic!.id)}
                    style={{ flexGrow: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 9, padding: folded ? "3px 8px" : "5px 8px", borderRadius: 8, background: "transparent", border: `1px solid ${cursor === `epic:${g.epic!.id}` ? T.apricot : "transparent"}`, cursor: "pointer", textAlign: "left", fontFamily: T.ui, ...(here ? { ...ACTIVE, background: look.bg, boxShadow: `inset 3px 0 0 ${look.fg}` } : {}) }}
                >
                    <EpicAvatar look={look} size={folded ? 16 : 20} running={g.agent?.sessions[0]?.state === "working"} />
                    <span style={{ flexGrow: 1, minWidth: 0, fontSize: folded ? 12 : 12.5, fontWeight: folded ? 500 : 700, letterSpacing: "0.02em", color: folded ? T.muted : look.fg, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortName(g.epic!)}</span>
                    {g.agent?.band === "needs" && <span data-wintos="epic-agent-state" style={{ fontSize: 10.5, fontWeight: 600, color: T.apricot }}>agent: your move</span>}
                    {!folded && <span style={{ fontFamily: T.mono, fontSize: 11, color: waiting ? T.apricot : T.faint }}>{waiting ? `${waiting} waiting` : g.rows.length}</span>}
                </button>
                <NewSession epic={g.epic!.id} newStep={newStep} />
            </div>
        );
    };
    const full = groups.filter((g) => !empty(g));
    const folded = groups.filter(empty);
    return (
        <div data-wintos="epic-groups" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {full.map((g) => {
                const look = g.epic ? lookOf(g.epic) : NO_EPIC;
                return (
                    <div key={g.epic?.id ?? "none"} data-epic-group={g.epic?.id ?? ""} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {g.epic ? header(g, false) : <span style={{ padding: "5px 8px", fontSize: 12, fontWeight: 600, color: T.faint }}>Outside the epics</span>}
                        <div style={{ display: "flex", flexDirection: "column", gap: 3, paddingLeft: 10, borderLeft: `2px solid ${g.epic ? look.ring : T.border}`, marginLeft: 17 }}>
                            {g.rows.map(renderRow)}
                            {bgOf(g).map((s) => (
                                        <button key={s.id} type="button" data-wintos="epic-bg-session" data-session={s.id} tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => openBackground(s.bgId!)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "3px 8px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left", fontFamily: T.ui, fontSize: 12, color: T.secondary, minWidth: 0 }}>
                                            <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: SESSION_DOT[s.state] }} />
                                            <span style={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sessionName(s)}</span>
                                            <span style={{ flexShrink: 0, fontSize: 10.5, color: s.state === "waiting" ? T.apricot : T.faint }}>background · {STATE_WORD[s.state]}</span>
                                        </button>
                                    ))}
                        </div>
                    </div>
                );
            })}
            {folded.length > 0 && (
                <div data-wintos="epic-groups-folded" style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    {folded.map((g) => (
                        <div key={g.epic!.id} data-epic-group={g.epic!.id} data-folded>
                            {header(g, true)}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// The + at the end of an epic's heading: ⌘N's sheet on that epic.
function NewSession({ epic, newStep }: { epic: string; newStep: (epic: string) => void }) {
    return (
        <button type="button" data-wintos="epic-new-step" title="New session in this epic (⌘N)" aria-label="New session in this epic" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => newStep(epic)} style={{ flexShrink: 0, padding: "2px 8px", background: "transparent", border: "none", borderRadius: 5, cursor: "pointer", fontFamily: T.ui, fontSize: 14, lineHeight: 1, color: T.faint }}>
            +
        </button>
    );
}
