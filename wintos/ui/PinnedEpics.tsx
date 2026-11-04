import { memo } from "react";
import type { Session } from "../daemon/sessions/reduce";
import { EpicAvatar } from "./EpicAvatar";
import { lookOf, shortName } from "./epicLook";
import { openEpic } from "./menu";
import { shownState } from "./sessions";
import { T } from "./tokens";
import { sessionName, type EpicView } from "./view";

// The epics you drive (p on an epic's page), always at the top of the sidebar so they keep
// moving: what waits on you there, else what is at work, else the next planned step. A click,
// or ⌘J/⌘K to it, opens the epic's page.
export const PinnedEpics = memo(({ epics, sessions, now, cursor }: { epics: EpicView[]; sessions: Session[]; now: number; cursor: string | null }) => {
    if (!epics.length) return null;
    return (
        <div data-wintos="pinned-epics" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {epics.map((e) => {
                const look = lookOf(e);
                const here = sessions.filter((s) => s.epic === e.id);
                const waiting = here.filter((s) => shownState(s, now) === "waiting");
                const working = here.filter((s) => shownState(s, now) === "working");
                const next = e.steps.find((x) => x.state !== "done")?.name;
                const line = waiting.length
                    ? { text: `${sessionName(waiting[0])}${waiting.length > 1 ? ` +${waiting.length - 1}` : ""} waits on you`, color: T.apricot }
                    : working.length
                      ? { text: `${sessionName(working[0])} at work`, color: T.moss }
                      : next
                        ? { text: `next: ${next}`, color: T.muted }
                        : { text: here.length ? `${here.length} quiet` : "nothing open: ⌘N starts the next step", color: T.faint };
                return (
                    <button
                        key={e.id}
                        type="button"
                        data-row={`epic:${e.id}`}
                        data-epic={e.id}
                        data-key="⌘J / ⌘K"
                        tabIndex={-1}
                        onMouseDown={(ev) => ev.preventDefault()}
                        onClick={() => openEpic(e.id)}
                        style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 9, background: `linear-gradient(90deg, ${look.bg} 0%, ${T.card} 80%)`, border: `1px solid ${cursor === `epic:${e.id}` ? T.apricot : T.border}`, borderLeft: `3px solid ${look.fg}`, cursor: "pointer", textAlign: "left", fontFamily: T.ui, minWidth: 0 }}
                    >
                        <EpicAvatar look={look} size={26} />
                        <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flexGrow: 1 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: T.emphasis, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortName(e)}</span>
                            <span style={{ fontSize: 11.5, color: line.color, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{line.text}</span>
                        </span>
                    </button>
                );
            })}
        </div>
    );
});
PinnedEpics.displayName = "PinnedEpics";
