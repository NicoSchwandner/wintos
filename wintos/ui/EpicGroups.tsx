import type { Row } from "../daemon/ranking/rank";
import { EpicAvatar } from "./EpicAvatar";
import { lookOf, NO_EPIC, shortName } from "./epicLook";
import { openEpic } from "./menu";
import { T } from "./tokens";
import type { EpicView } from "./view";

// agent: the epic agent's own row, shown as the epic's header rather than as a row under it:
// going to the epic and going to its agent are the same.
export type EpicGroup = { epic?: EpicView; rows: Row[]; agent?: Row };

// The sidebar by epic (⌥⌘V): each open epic with its sessions under it, pinned epics first, then
// those where something waits on you, reads, runs, then the quiet ones. Sessions in no epic, and
// tabs without a session, come last. Rows keep the order the state list gave them.
const BAND_RANK = { needs: 0, read: 1, running: 2, quiet: 3 } as const;
export function groupByEpic(rows: Row[], epics: EpicView[]): EpicGroup[] {
    const open = epics.filter((e) => !e.done);
    const of = (r: Row) => (r.key !== r.tabId ? r.sessions[0]?.epic : undefined);
    const isAgent = (r: Row, e: EpicView) => !!e.agent && r.key === `s:${e.agent}`;
    const groups = open.map((epic) => ({ epic, rows: rows.filter((r) => of(r) === epic.id && !isAgent(r, epic)), agent: rows.find((r) => isAgent(r, epic)) }));
    const best = (g: EpicGroup) => Math.min(4, ...[...g.rows, ...(g.agent ? [g.agent] : [])].map((r) => BAND_RANK[r.band]));
    groups.sort((a, b) => Number(!!b.epic?.pinned) - Number(!!a.epic?.pinned) || best(a) - best(b) || b.rows.length - a.rows.length);
    const known = new Set(open.map((e) => e.id));
    const agents = new Set(groups.flatMap((g) => (g.agent ? [g.agent.key] : [])));
    const loose = rows.filter((r) => (!of(r) || !known.has(of(r)!)) && !agents.has(r.key));
    return [...groups, ...(loose.length ? [{ rows: loose }] : [])];
}

export function EpicGroups({ groups, renderRow, cursor, newStep }: { groups: EpicGroup[]; renderRow: (r: Row) => React.ReactNode; cursor: string | null; newStep: (epic: string) => void }) {
    return (
        <div data-wintos="epic-groups" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {groups.map((g) => {
                const look = g.epic ? lookOf(g.epic) : NO_EPIC;
                const waiting = g.rows.filter((r) => r.band === "needs").length;
                const agent = g.agent?.band;
                return (
                    <div key={g.epic?.id ?? "none"} data-epic-group={g.epic?.id ?? ""} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {g.epic ? (
                            <button
                                type="button"
                                data-row={`epic:${g.epic.id}`}
                                data-key="⌘J / ⌘K"
                                tabIndex={-1}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => openEpic(g.epic!.id)}
                                style={{ display: "flex", alignItems: "center", gap: 9, padding: "5px 8px", borderRadius: 8, background: "transparent", border: `1px solid ${cursor === `epic:${g.epic.id}` ? T.apricot : "transparent"}`, cursor: "pointer", textAlign: "left", fontFamily: T.ui }}
                            >
                                <EpicAvatar look={look} size={20} running={g.agent?.sessions[0]?.state === "working"} />
                                <span style={{ flexGrow: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, letterSpacing: "0.02em", color: look.fg, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortName(g.epic)}</span>
                                {agent === "needs" && <span data-wintos="epic-agent-state" style={{ fontSize: 10.5, fontWeight: 600, color: T.apricot }}>agent: your move</span>}
                                <span style={{ fontFamily: T.mono, fontSize: 11, color: waiting ? T.apricot : T.faint }}>{waiting ? `${waiting} waiting` : g.rows.length ? `${g.rows.length}` : "–"}</span>
                            </button>
                        ) : (
                            <span style={{ padding: "5px 8px", fontSize: 12, fontWeight: 600, color: T.faint }}>Outside the epics</span>
                        )}
                        <div style={{ display: "flex", flexDirection: "column", gap: 3, paddingLeft: 10, borderLeft: `2px solid ${g.epic ? look.ring : T.border}`, marginLeft: 17 }}>
                            {g.rows.map(renderRow)}
                            {g.epic && (
                                <button type="button" data-wintos="epic-new-step" data-key="⌘N" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => newStep(g.epic!.id)} style={{ alignSelf: "flex-start", padding: "3px 8px", background: "transparent", border: "none", cursor: "pointer", fontFamily: T.ui, fontSize: 12, color: T.faint }}>
                                    + new step
                                </button>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
