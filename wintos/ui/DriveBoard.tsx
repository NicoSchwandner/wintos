import { memo } from "react";
import { prsByTab } from "./attention";
import { driveDay, driveDayLine } from "./driveDay";
import { enterProject } from "./focus";
import { Panel } from "./TodayPage";
import { T } from "./tokens";
import { useNow } from "./useNow";
import { useWintos } from "./useWintos";
import { ghPrs } from "./view";

// The driving projects on the day's pages: what each is for next and how far today got.
export const DriveBoard = memo(() => {
    const { state } = useWintos();
    const now = useNow();
    const driving = state?.driving ?? [];
    if (!state || !driving.length) return null;
    const prs = prsByTab(driving, state);
    const me = ghPrs(state)?.me;
    return (
        <Panel label="Driving today">
            {driving.map((id) => {
                const p = state.projects.find((x) => x.id === id);
                const d = driveDay(state.activityToday?.[id], prs[id]?.items.map((i) => i.pr) ?? [], me, now);
                return (
                    <button key={id} type="button" data-key="" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => enterProject(id)}
                        style={{ display: "flex", flexDirection: "column", gap: 3, padding: "6px 8px", margin: "0 -8px", borderRadius: 8, background: "transparent", border: "none", cursor: "pointer", textAlign: "left", fontFamily: T.ui }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600, color: T.text }}>{p?.title ?? "Untitled"}</span>
                        {p?.next && <span style={{ fontSize: 12.5, color: T.secondary }}>Next: {p.next}</span>}
                        <span style={{ fontFamily: T.mono, fontSize: 11.5, color: d.waitedMs >= 30 * 60_000 ? T.apricot : T.muted }}>{driveDayLine(d)}</span>
                    </button>
                );
            })}
        </Panel>
    );
});
DriveBoard.displayName = "DriveBoard";
