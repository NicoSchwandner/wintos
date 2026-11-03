// What the Herdr mods compute from wintosd's state: WintOS's own logic, bundled for Herdr, where
// a project is a Herdr tab and a session's pane is its terminal.
import { attention } from "../ui/attention";
import { driveDay, driveDayLine } from "../ui/driveDay";
import { ghPrs, prOwners, prProjects, reopenFor, relTime, type WintosState } from "../ui/view";
import { GROUP_HEADERS } from "../ui/prGroups";
import { queueModel } from "../ui/prs";
import { lastMovement, nextWorkingDayStart } from "../daemon/prs/group";
import { deliverable, type Delivery } from "../ui/wakePlan";

export { relTime, nextWorkingDayStart };

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
        prs: prCounts(state, now),
        order: [...a.driving.flatMap((d) => d.lines.filter((l) => l.state !== "running").map((l) => l.blockId)), ...[...a.needs, ...a.read].flatMap((r) => (a.targets[r.tabId] ? [a.targets[r.tabId].blockId] : []))],
    };
}

function prCounts(state: WintosState, now: number) {
    const gh = ghPrs(state);
    if (!gh) return { yours: 0, late: 0 };
    const m = queueModel(gh.prs, gh.me, now, state.snoozes, gh.team);
    return { yours: m.yours, late: m.pastSla };
}

// Every Herdr tab's due wakes: one window serves them all.
export const deliveries = (state: WintosState, tabIds: string[]): (Delivery & { tabId: string })[] =>
    tabIds.flatMap((tabId) => deliverable(state.wakes ?? {}, state.sessions, state.shelf?.[tabId] ?? [], tabId).map((d) => ({ ...d, tabId })));

// Where o on a PR leads: the session that owns it, live (its terminal) or closed (resumed); else
// its project's tab; else a new project for it.
export type PrGo = { kind: "terminal"; tabId: string; terminal: string } | { kind: "resume"; tabId: string; script: string; open: boolean } | { kind: "tab"; tabId: string } | { kind: "new"; url: string };
export function prGo(state: WintosState, tabIds: string[], url: string): PrGo {
    const tabId = prProjects(tabIds, state).get(url);
    if (!tabId) return { kind: "new", url };
    const owner = prOwners(state, tabId).get(url);
    if (owner && "blockId" in owner) return { kind: "terminal", tabId, terminal: owner.blockId };
    const shelved = owner && "resume" in owner ? owner.resume : !tabIds.includes(tabId) ? reopenFor(state.shelf?.[tabId] ?? [], url)?.script : undefined;
    if (shelved) return { kind: "resume", tabId, script: shelved, open: tabIds.includes(tabId) };
    return { kind: "tab", tabId };
}

// The PRs page: WintOS's groups, each row with who owns it and where o leads.
export function prPage(state: WintosState, tabIds: string[], now: number) {
    const gh = ghPrs(state);
    if (!gh) return undefined;
    const m = queueModel(gh.prs, gh.me, now, state.snoozes, gh.team);
    const projects = prProjects(tabIds, state);
    const row = (r: (typeof m.groups)[number]["rows"][number]) => {
        const tabId = projects.get(r.pr.url);
        const owner = tabId ? prOwners(state, tabId).get(r.pr.url) : undefined;
        const project = tabId ? state.projects.find((p) => p.id === tabId)?.title : undefined;
        return { url: r.pr.url, number: r.pr.number, title: r.pr.title, repo: r.pr.repo.split("/").pop()!, author: r.mine ? "you" : r.pr.author, age: r.age.text, late: !!r.age.late, why: r.qualifier?.text, owner: owner?.name, live: !!owner && "blockId" in owner, project, movedAt: lastMovement(r.pr) };
    };
    return {
        counts: { yours: m.yours, waiting: m.waiting, team: m.team },
        groups: m.groups.map((g) => ({ group: g.group, label: GROUP_HEADERS[g.group].label, note: GROUP_HEADERS[g.group].note, rows: g.rows.flatMap((r) => [r, ...r.children]).map(row) })),
        snoozed: m.snoozed.map(row),
    };
}
