import { useFocusOnMount } from "./useFocusOnMount";
import { useZoneKeys } from "./zones";
import { enterProject } from "./focus";
import { atoms, createTab } from "@/store/global";
import { offerPrompt, prLinkPaste } from "./newproject";
import { useAtomValue } from "jotai";
import { useOnResize } from "@/app/hook/useDimensions";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { Group } from "../daemon/prs/group";
import { runAction } from "./menu";
import { Key, KeyOr } from "./Key";
import { initials, keepSelection, queueModel, reviewerChips, rowColumns, type QueueRow, type RowColumns } from "./prs";
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

// The Inbox's PR list (⇧⌘G): every PR that concerns you, grouped by the action it asks of you.
// A PR opens as an ordinary browser pane beside it, in the Inbox's own layout.
// pageOpen: a page is open beside the list, so Esc or ⌘L has somewhere to go.
export const PrQueue = memo(({ pageOpen }: { pageOpen: boolean }) => {
    const focusRef = useFocusOnMount<HTMLDivElement>();
    // The rows drop the author, size and full reviewer names only when there is no room for them:
    // the list alone, or a wide screen with a page beside it, shows everything.
    const rowsRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    useOnResize(rowsRef, useCallback((r: DOMRectReadOnly) => setWidth(r.width), []));
    const cols = rowColumns(width);
    const { state } = useWintos();
    const now = useNow();
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

    const openPr = (r: QueueRow) => runAction(`open-page:${r.pr.url}`);
    const tabIds = useAtomValue(atoms.workspace)?.tabids ?? [];
    const projectOf = state ? prProjects(tabIds, state) : new Map<string, string>();
    const titleOf = (tabId: string) => state?.projects.find((p) => p.id === tabId)?.title ?? "its project";
    // o: the PR's project, or a new one for it whose Claude prompt starts with the PR's link.
    const goToProject = (r: QueueRow) => {
        const tabId = projectOf.get(r.pr.url);
        if (!tabId) return void (offerPrompt(prLinkPaste(r.pr.url)), createTab());
        enterProject(tabId);
    };
    const refresh = async () => {
        setRefreshing(true);
        await daemonFetch("/plugins/gh-prs/run", { method: "POST", body: {} }).catch(() => {});
        setRefreshing(false);
    };

    const r = flat[Math.min(cursor, flat.length - 1)];
    useZoneKeys(focusRef, {
        j: () => step(1),
        k: () => step(-1),
        Enter: () => (r ? openPr(r) : false),
        o: () => (r ? goToProject(r) : false),
        r: (e) => void (e.repeat || refresh()),
        z: (e) => {
            if (!r || e.repeat) return;
            // Snoozing sends the PR to the bottom; carry on with the next one instead.
            if (!snoozedUrls.has(r.pr.url)) setSelected(urls[cursor + 1] ?? urls[cursor - 1]);
            void toggleSnooze(r);
        },
    });
    return (
        <div
            data-wintos="inbox-list"
            tabIndex={0}
            ref={focusRef}
            data-zone="list"
            style={{ flexGrow: 1, display: "flex", flexDirection: "column", background: "#1d2021", outline: "none", fontFamily: T.ui, minWidth: 0, minHeight: 0 }}
        >
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
            <div ref={rowsRef} style={{ flexGrow: 1, overflowY: "auto", padding: "0 26px", display: "flex", flexDirection: "column", gap: 14 }}>
                {model?.groups.map(({ group, rows }) => (
                    <div key={group} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <GroupHeader {...HEADERS[group]} count={rows.length} />
                        {rows.flatMap((row) => withStack(row)).map(({ r, depth }) => (
                            <PrRow key={r.pr.url} r={r} depth={depth} project={projectOf.has(r.pr.url) ? titleOf(projectOf.get(r.pr.url)!) : undefined} cursor={flat[cursor] === r} cols={cols} onOpen={() => openPr(r)} />
                        ))}
                    </div>
                ))}
                {model && model.snoozed.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, opacity: 0.6 }}>
                        <GroupHeader label="Snoozed" note="back next working day, or when it moves · z wakes" color={T.muted} count={model.snoozed.length} />
                        {model.snoozed.map((r) => (
                            <PrRow key={r.pr.url} r={r} depth={0} project={projectOf.has(r.pr.url) ? titleOf(projectOf.get(r.pr.url)!) : undefined} cursor={flat[cursor] === r} cols={cols} onOpen={() => openPr(r)} />
                        ))}
                    </div>
                )}
                {model && model.groups.length === 0 && <span style={{ color: T.muted, fontSize: 13, padding: "0 12px" }}>Nothing open that concerns you.</span>}
            </div>
            <div style={{ flexShrink: 0, minHeight: 30, padding: "4px 26px", boxSizing: "border-box", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 14px", borderTop: `1px solid ${T.hairline}`, background: T.sidebar }}>
                <Key k="j k" label="row" />
                <Key k="⏎" label="open" />
                <Key k="o" label={flat[cursor] && !projectOf.has(flat[cursor].pr.url) ? "open as new project" : "go to project"} off={!flat[cursor]} />
                <Key k="z" label="snooze" />
                {pageOpen && <KeyOr keys={["esc", "⌘L"]} label="to the page" />}
            </div>
        </div>
    );
});
PrQueue.displayName = "PrQueue";

const CHIP: React.CSSProperties = { flexShrink: 0, maxWidth: 96, padding: "2px 7px", borderRadius: 10, border: `1px solid ${T.keycapBorder}`, fontSize: 10.5, color: T.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

function Reviewers({ r, names }: { r: QueueRow; names: boolean }) {
    const compact = !names;
    const { chips, more, none, approved } = reviewerChips(r.pr, compact ? 1 : 2);
    return (
        // As wide as its chips (up to a cap), so a short reviewer list leaves the room to the title.
        <span style={{ maxWidth: compact ? 70 : 230, flexShrink: 0, display: "flex", justifyContent: "flex-end", gap: 4, overflow: "hidden" }}>
            {chips.map((c) => (
                <span key={c} title={c} style={CHIP}>
                    {compact ? initials(c) : c}
                </span>
            ))}
            {more > 0 && <span style={{ ...CHIP, color: T.faint }}>+{more}</span>}
            {approved.map((a) => (
                <span key={a} title={`approved by ${a}`} style={{ ...CHIP, color: T.moss, borderColor: T.moss }}>
                    ✓ {compact ? initials(a) : a}
                </span>
            ))}
            {none && <span style={{ ...CHIP, color: T.brick, borderColor: T.brick }}>none</span>}
        </span>
    );
}

function GroupHeader({ label, note, color, count }: { label: string; note: string; color: string; count: number }) {
    return (
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "0 12px 4px" }}>
            <span style={{ fontFamily: T.display, fontSize: 18, color }}>{label}</span>
            <span style={{ fontSize: 11, color: T.faint }}>{note}</span>
            <span style={{ flexGrow: 1, height: 1, background: "#32302f" }} />
            <span style={{ fontFamily: T.mono, fontSize: 10, color: T.faint }}>{count}</span>
        </div>
    );
}

// project: the title of the project this PR belongs to, for its marker (o goes there).
function PrRow({ r, depth, project, cursor, cols, onOpen }: { r: QueueRow; depth: number; project?: string; cursor: boolean; cols: RowColumns; onOpen: () => void }) {
    const { pr } = r;
    const compact = !cols.names;
    return (
        <div
            data-pr={`${pr.repo}#${pr.number}`}
            data-selected={cursor || undefined}
            data-key="j k ⏎"
            onClick={onOpen}
            style={{ display: "flex", alignItems: "center", gap: 16, height: 44, padding: "0 12px", marginLeft: depth * 22, overflow: "hidden", borderRadius: 10, cursor: "pointer", background: cursor ? T.cardActive : "transparent", border: `1px solid ${cursor ? T.borderActive : "transparent"}` }}
        >
            {depth > 0 && <span style={{ marginRight: -8, fontFamily: T.mono, color: T.faint }}>└</span>}
            <span style={{ width: 54, flexShrink: 0, fontFamily: T.mono, fontSize: 12.5, color: r.age.late ? T.brick : T.quietTitle }}>{r.age.text}</span>
            <span style={{ width: compact ? 22 : 118, flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 22, height: 22, borderRadius: "50%", background: r.mine ? "#504945" : "#3c3836", color: r.mine ? "#fbf1c7" : "#d5c4a1", fontFamily: T.mono, fontSize: 8.5, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {initials(pr.author)}
                </span>
                {!compact && <span style={{ fontSize: 12, color: r.mine ? T.title : T.quietTitle, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.mine ? "you" : pr.author}</span>}
            </span>
            {cols.size && <span style={{ width: 104, flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
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
            <Reviewers r={r} names={cols.names} />
            <span title={project ? `Project: ${project} (o)` : "No project"} style={{ width: 12, flexShrink: 0, textAlign: "center", fontSize: 11, color: project ? T.moss : "transparent" }}>◆</span>
            <span style={{ width: compact ? 120 : 150, flexShrink: 0, textAlign: "right", fontFamily: T.mono, fontSize: 10.5, color: T.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.repoShort} #{pr.number}
            </span>
        </div>
    );
}
