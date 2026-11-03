// What the Herdr mods compute from wintosd's state: WintOS's own logic, bundled for Herdr, where
// a project is a Herdr tab and a session's pane is its terminal.
import { attention } from "../ui/attention";
import { driveDay, driveDayLine } from "../ui/driveDay";
import { ghPrs, relTime, type WintosState } from "../ui/view";
import { deliverable, type Delivery } from "../ui/wakePlan";

export { relTime };

export function sidebar(state: WintosState, tabIds: string[], names: Record<string, string>, now: number, here?: string) {
    const a = attention(tabIds, state, names, now, here);
    const me = ghPrs(state)?.me;
    const today = (tabId: string) => driveDayLine(driveDay(state.activityToday?.[tabId], a.prs[tabId]?.items.map((i) => i.pr) ?? [], me, now));
    const row = (r: { tabId: string; sessions: { blockId: string; state: string }[] }) => ({ tabId: r.tabId, view: a.views[r.tabId], target: a.targets[r.tabId] });
    return {
        driving: a.driving.map((d) => ({ ...row(d.row), lines: d.lines, today: today(d.row.tabId) })),
        needs: a.needs.map(row),
        read: a.read.map(row),
        running: a.running.map(row),
        quiet: [...a.quiet, ...a.quietMore, ...a.quietStale].map(row),
        // agent.next follows the sidebar: what waits on you in the projects you drive, then the rest.
        order: [...a.driving.flatMap((d) => d.lines.filter((l) => l.state !== "running").map((l) => l.blockId)), ...[...a.needs, ...a.read].flatMap((r) => (a.targets[r.tabId] ? [a.targets[r.tabId].blockId] : []))],
    };
}

// Every Herdr tab's due wakes: one window serves them all.
export const deliveries = (state: WintosState, tabIds: string[]): (Delivery & { tabId: string })[] =>
    tabIds.flatMap((tabId) => deliverable(state.wakes ?? {}, state.sessions, state.shelf?.[tabId] ?? [], tabId).map((d) => ({ ...d, tabId })));
