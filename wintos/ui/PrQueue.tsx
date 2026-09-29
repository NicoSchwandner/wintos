import { useFocusOnMount } from "./useFocusOnMount";
import { isPlainKey } from "./keys";
import { enterProject, focusArea } from "./focus";
import { atoms } from "@/store/global";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { memo, useEffect, useRef, useState } from "react";
import type { Group } from "../daemon/prs/group";
import { mainViewAtom, prTabsAtom } from "./notes/state";
import { PrBrowser } from "./PrBrowser";
import { closeTab, openTab } from "./prtabs";
import { Key } from "./Key";
import { initials, keepSelection, queueModel, reviewerChips, type QueueRow } from "./prs";
import { lastMovement, nextWorkingDayStart } from "../daemon/prs/group";
import { T } from "./tokens";
import { useNow } from "./useNow";
import { daemonFetch, useWintos } from "./useWintos";
import { ghPrs, prProjects, relTime } from "./view";

export const HEADERS: Record<Group, { label: string; note: string; color: string }> = {
    merge: { label: "Merge", note: "approved, green, waiting on the button", color: T.moss },
    fix: { label: "Fix", note: "your PR, ball in your court", color: T.apricot },
    review: { label: "Review", note: "someone asked you", color: T.title },
    chase: { label: "Chase", note: "past the team's two working days with nobody on it", color: T.brick },
    waiting: { label: "Waiting", note: "yours, with someone else", color: T.muted },
    team: { label: "The team's", note: "asked of your team: yours to review too", color: T.muted },
};

// ⇧⌘G: every PR that concerns you, grouped by the action it asks of you (spec §4, PRQueueC).
export const PrQueue = memo(() => {
    const focusRef = useFocusOnMount<HTMLDivElement>();
    const { state } = useWintos();
    const now = useNow();
    const setView = useSetAtom(mainViewAtom);
    const [selected, setSelected] = useState<string | undefined>();
    const shownBefore = useRef<string[]>([]);
    const [refreshing, setRefreshing] = useState(false);
    const result = state?.plugins?.["gh-prs"];
    const gh = state && ghPrs(state);
    const model = gh ? queueModel(gh.prs, gh.me, now, state?.snoozes) : null;
    // A stacked PR's row follows its base, one indent per step; the cursor walks them in order.
    const withStack = (r: QueueRow, depth = 0): { r: QueueRow; depth: number }[] => [{ r, depth }, ...r.children.flatMap((c) => withStack(c, depth + 1))];
    const flat = [...(model?.groups.flatMap((g) => g.rows.flatMap((r) => withStack(r).map((x) => x.r))) ?? []), ...(model?.snoozed ?? [])];
    const snoozedUrls = new Set(model?.snoozed.map((r) => r.pr.url));
    const urls = flat.map((r) => r.pr.url);
    const current = keepSelection(shownBefore.current, urls, selected);
    const cursor = Math.max(0, urls.indexOf(current ?? ""));
    useEffect(() => {
        shownBefore.current = urls;
        if (current !== selected) setSelected(current);
    }, [urls.join(" ")]);
    const step = (d: 1 | -1) => setSelected(urls[Math.max(0, Math.min(cursor + d, urls.length - 1))]);
    // z: looked at, handed on. Back at the next working day, or as soon as the PR moves.
    const toggleSnooze = (r: QueueRow) =>
        daemonFetch("/prs/snooze", { method: "POST", body: snoozedUrls.has(r.pr.url) ? { url: r.pr.url, until: null } : { url: r.pr.url, until: nextWorkingDayStart(Date.now()), movedAt: lastMovement(r.pr) } }).catch(() => {});

    // The terminals are hidden behind this view, so a PR opens beside the list, not as a block.
    const [tabs, setTabs] = useAtom(prTabsAtom);
    const openUrl = tabs.urls.length ? tabs.urls[tabs.active] : null;
    const openPr = (r: QueueRow) => setTabs((t) => openTab(t, r.pr.url));
    const tabIds = useAtomValue(atoms.workspace)?.tabids ?? [];
    const projectOf = state ? prProjects(tabIds, state) : new Map<string, string>();
    const titleOf = (tabId: string) => state?.projects.find((p) => p.id === tabId)?.title ?? "its project";
    const goToProject = (r: QueueRow) => {
        const tabId = projectOf.get(r.pr.url);
        if (!tabId) return;
        setView("terminal");
        enterProject(tabId);
    };
    const refresh = async () => {
        setRefreshing(true);
        await daemonFetch("/plugins/gh-prs/run", { method: "POST", body: {} }).catch(() => {});
        setRefreshing(false);
    };

    return (
        <div
            data-wintos="pr-queue"
            tabIndex={0}
            ref={focusRef}
            onKeyDown={(e) => {
                if (!isPlainKey(e) && e.key !== "Escape") return;
                const r = flat[Math.min(cursor, flat.length - 1)];
                if (e.key === "j") step(1);
                else if (e.key === "k") step(-1);
                else if (e.key === "Enter" && r) openPr(r);
                else if (e.key === "o" && r) goToProject(r);
                else if (e.key === "r" && !e.repeat) void refresh();
                else if (e.key === "z" && r && !e.repeat) {
                    // Snoozing sends the PR to the bottom; carry on with the next one instead.
                    if (!snoozedUrls.has(r.pr.url)) setSelected(urls[cursor + 1] ?? urls[cursor - 1]);
                    void toggleSnooze(r);
                }
                else if (e.key === "Escape") openUrl ? setTabs((t) => closeTab(t, t.active)) : focusArea("terminal");
                else return;
                e.preventDefault();
            }}
            style={{ flexGrow: 1, display: "flex", background: "#171413", outline: "none", fontFamily: T.ui, minWidth: 0, minHeight: 0 }}
        >
            <div style={{ flexGrow: openUrl ? 0 : 1, width: openUrl ? "44%" : undefined, minWidth: openUrl ? 440 : 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "18px 26px 16px", display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
                    <h1 style={{ margin: 0, fontFamily: T.display, fontSize: 30, fontWeight: 400, lineHeight: 1, color: T.emphasis }}>PRs need attention</h1>
                    {model && <span style={{ fontSize: 12, color: T.muted }}>{model.yours} yours · {model.waiting} waiting · {model.team} team</span>}
                </div>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11, color: result && !result.ok ? T.brick : T.faint }}>
                    {refreshing ? "refreshing…" : result ? (result.ok ? `GitHub · ${relTime(now - result.at)} ago` : `GitHub failed ${relTime(now - result.at)} ago: ${result.error}`) : "fetching from GitHub…"}
                    <Key k="r" label="" />
                </span>
            </div>
            <div style={{ flexGrow: 1, overflowY: "auto", padding: "0 26px", display: "flex", flexDirection: "column", gap: 14 }}>
                {model?.groups.map(({ group, rows }) => (
                    <div key={group} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <GroupHeader {...HEADERS[group]} count={rows.length} />
                        {rows.flatMap((row) => withStack(row)).map(({ r, depth }) => (
                            <PrRow key={r.pr.url} r={r} depth={depth} project={projectOf.has(r.pr.url) ? titleOf(projectOf.get(r.pr.url)!) : undefined} cursor={flat[cursor] === r || r.pr.url === openUrl} compact={!!openUrl} onOpen={() => openPr(r)} />
                        ))}
                    </div>
                ))}
                {model && model.snoozed.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, opacity: 0.6 }}>
                        <GroupHeader label="Snoozed" note="back next working day, or when it moves · z wakes" color={T.muted} count={model.snoozed.length} />
                        {model.snoozed.map((r) => (
                            <PrRow key={r.pr.url} r={r} depth={0} project={projectOf.has(r.pr.url) ? titleOf(projectOf.get(r.pr.url)!) : undefined} cursor={flat[cursor] === r || r.pr.url === openUrl} compact={!!openUrl} onOpen={() => openPr(r)} />
                        ))}
                    </div>
                )}
                {model && model.groups.length === 0 && <span style={{ color: T.muted, fontSize: 13, padding: "0 12px" }}>Nothing open that concerns you.</span>}
            </div>
            <div style={{ flexShrink: 0, height: 30, padding: "0 26px", display: "flex", alignItems: "center", gap: 14, borderTop: `1px solid ${T.hairline}`, background: T.sidebar }}>
                <Key k="j k" label="row" />
                <Key k="⏎" label="open beside" />
                {openUrl && <Key k="⇥" label="into the PR" />}
                <Key k="o" label="go to project" off={!flat[cursor] || !projectOf.has(flat[cursor].pr.url)} />
                <Key k="z" label="snooze" />
                <Key k={openUrl ? "esc ⌘W" : "esc"} label={openUrl ? "close the tab" : "back"} />
            </div>
            </div>
            <PrBrowser />
        </div>
    );
});
PrQueue.displayName = "PrQueue";

// compact: with a PR open beside the list the row has ~400px, so the name and size columns go.
const CHIP: React.CSSProperties = { flexShrink: 0, maxWidth: 96, padding: "2px 7px", borderRadius: 10, border: `1px solid ${T.keycapBorder}`, fontSize: 10.5, color: T.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

function Reviewers({ r, compact }: { r: QueueRow; compact: boolean }) {
    const { chips, more, none } = reviewerChips(r.pr, compact ? 1 : 2);
    return (
        <span style={{ width: compact ? 70 : 190, flexShrink: 0, display: "flex", justifyContent: "flex-end", gap: 4 }}>
            {chips.map((c) => (
                <span key={c} title={c} style={CHIP}>
                    {compact ? initials(c) : c}
                </span>
            ))}
            {more > 0 && <span style={{ ...CHIP, color: T.faint }}>+{more}</span>}
            {none && <span style={{ ...CHIP, color: T.brick, borderColor: T.brick }}>none</span>}
        </span>
    );
}

function GroupHeader({ label, note, color, count }: { label: string; note: string; color: string; count: number }) {
    return (
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "0 12px 4px" }}>
            <span style={{ fontFamily: T.display, fontSize: 18, color }}>{label}</span>
            <span style={{ fontSize: 11, color: T.faint }}>{note}</span>
            <span style={{ flexGrow: 1, height: 1, background: "#201C1A" }} />
            <span style={{ fontFamily: T.mono, fontSize: 10, color: T.faint }}>{count}</span>
        </div>
    );
}

// project: the title of the project this PR belongs to, for its marker (o goes there).
function PrRow({ r, depth, project, cursor, compact, onOpen }: { r: QueueRow; depth: number; project?: string; cursor: boolean; compact: boolean; onOpen: () => void }) {
    const { pr } = r;
    return (
        <div
            data-pr={`${pr.repo}#${pr.number}`}
            onClick={onOpen}
            style={{ display: "flex", alignItems: "center", gap: 16, height: 44, padding: "0 12px", marginLeft: depth * 22, overflow: "hidden", borderRadius: 10, cursor: "pointer", background: cursor ? T.cardActive : "transparent", border: `1px solid ${cursor ? T.borderActive : "transparent"}` }}
        >
            {depth > 0 && <span style={{ marginRight: -8, fontFamily: T.mono, color: T.faint }}>└</span>}
            <span style={{ width: 54, flexShrink: 0, fontFamily: T.mono, fontSize: 12.5, color: r.age.late ? T.brick : T.quietTitle }}>{r.age.text}</span>
            <span style={{ width: compact ? 22 : 118, flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 22, height: 22, borderRadius: "50%", background: r.mine ? "#4A3B2C" : "#332E2B", color: r.mine ? "#EFC9A5" : "#C9B9AC", fontFamily: T.mono, fontSize: 8.5, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {initials(pr.author)}
                </span>
                {!compact && <span style={{ fontSize: 12, color: r.mine ? T.title : T.quietTitle, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.mine ? "you" : pr.author}</span>}
            </span>
            {!compact && <span style={{ width: 104, flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ display: "flex", gap: 2, width: 44 }}>
                    <span style={{ height: 5, borderRadius: 3, background: T.moss, flexGrow: Math.max(pr.additions, 0.5) }} />
                    <span style={{ height: 5, borderRadius: 3, background: T.brick, flexGrow: Math.max(pr.deletions, 0.5) }} />
                </span>
                <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.faint }}>{r.total}</span>
            </span>}
            <span style={{ flexGrow: 1, minWidth: 0, fontSize: 13.5, color: T.title, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {pr.isDraft && <span style={{ fontSize: 10, border: `1px solid ${T.keycapBorder}`, borderRadius: 5, padding: "1px 5px", marginRight: 8, color: T.muted }}>draft</span>}
                {pr.title}
                {r.qualifier && <span style={{ fontSize: 11, color: r.qualifier.brick ? T.brick : T.muted }}> — {r.qualifier.text}</span>}
            </span>
            <Reviewers r={r} compact={compact} />
            <span title={project ? `Project: ${project} (o)` : "No project"} style={{ width: 12, flexShrink: 0, textAlign: "center", fontSize: 11, color: project ? T.moss : "transparent" }}>◆</span>
            <span style={{ width: compact ? 120 : 150, flexShrink: 0, textAlign: "right", fontFamily: T.mono, fontSize: 10.5, color: T.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.repoShort} #{pr.number}
            </span>
        </div>
    );
}
