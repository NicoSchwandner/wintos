import { useFocusOnMount } from "./useFocusOnMount";
import { globalStore } from "@/app/store/jotaiStore";
import { atoms, createBlock, getApi } from "@/store/global";
import { useSetAtom } from "jotai";
import { memo, useState } from "react";
import type { Group } from "../daemon/prs/group";
import { mainViewAtom } from "./notes/state";
import { Key } from "./notes/NotesRail";
import { initials, queueModel, type QueueRow } from "./prs";
import { T } from "./tokens";
import { useNow } from "./useNow";
import { daemonFetch, useWintos } from "./useWintos";
import { ghPrs, prsByTab, relTime } from "./view";

const HEADERS: Record<Group, { label: string; note: string; color: string }> = {
    merge: { label: "Merge", note: "approved, green, waiting on the button", color: T.moss },
    fix: { label: "Fix", note: "your PR, ball in your court", color: T.apricot },
    review: { label: "Review", note: "someone asked you", color: T.title },
    chase: { label: "Chase", note: "past the team's two working days with nobody on it", color: T.brick },
    team: { label: "The team's", note: "not yours to move, useful to know", color: T.muted },
};

// ⇧⌘P: every PR that concerns you, grouped by the action it asks of you (spec §4, PRQueueC).
export const PrQueue = memo(() => {
    const focusRef = useFocusOnMount<HTMLDivElement>();
    const { state } = useWintos();
    const now = useNow();
    const setView = useSetAtom(mainViewAtom);
    const [cursor, setCursor] = useState(0);
    const [refreshing, setRefreshing] = useState(false);
    const result = state?.plugins?.["gh-prs"];
    const gh = state && ghPrs(state);
    const model = gh ? queueModel(gh.prs, gh.me, now) : null;
    const flat = model?.groups.flatMap((g) => g.rows) ?? [];

    const openPr = (r: QueueRow) => createBlock({ meta: { view: "web", url: r.pr.url } });
    const goToProject = (r: QueueRow) => {
        const ws = globalStore.get(atoms.workspace);
        const byTab = state ? prsByTab(ws?.tabids ?? [], state) : {};
        const tabId = Object.entries(byTab).find(([, v]) => v.items.some((i) => i.pr.url === r.pr.url))?.[0];
        if (!tabId) return;
        setView("terminal");
        getApi().setActiveTab(tabId);
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
                const r = flat[Math.min(cursor, flat.length - 1)];
                if (e.key === "j") setCursor((c) => Math.min(c + 1, flat.length - 1));
                else if (e.key === "k") setCursor((c) => Math.max(c - 1, 0));
                else if (e.key === "Enter" && r) openPr(r);
                else if (e.key === "o" && r) goToProject(r);
                else if (e.key === "r" && !e.repeat) void refresh();
                else if (e.key === "Escape") setView("terminal");
                else return;
                e.preventDefault();
            }}
            style={{ flexGrow: 1, display: "flex", flexDirection: "column", background: "#171413", outline: "none", fontFamily: T.ui, minWidth: 0 }}
        >
            <div style={{ padding: "18px 26px 16px", display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
                    <h1 style={{ margin: 0, fontFamily: T.display, fontSize: 30, fontWeight: 400, lineHeight: 1, color: T.emphasis }}>PRs need attention</h1>
                    {model && <span style={{ fontSize: 12, color: T.muted }}>{model.yours} yours · {model.team} team</span>}
                </div>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11, color: result && !result.ok ? T.brick : T.faint }}>
                    {refreshing ? "refreshing…" : result ? (result.ok ? `GitHub · ${relTime(now - result.at)} ago` : `GitHub failed ${relTime(now - result.at)} ago: ${result.error}`) : "fetching from GitHub…"}
                    <Key k="r" label="" />
                </span>
            </div>
            <div style={{ flexGrow: 1, overflowY: "auto", padding: "0 26px", display: "flex", flexDirection: "column", gap: 14 }}>
                {model?.groups.map(({ group, rows }) => (
                    <div key={group} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "0 12px 4px" }}>
                            <span style={{ fontFamily: T.display, fontSize: 18, color: HEADERS[group].color }}>{HEADERS[group].label}</span>
                            <span style={{ fontSize: 11, color: T.faint }}>{HEADERS[group].note}</span>
                            <span style={{ flexGrow: 1, height: 1, background: "#201C1A" }} />
                            <span style={{ fontFamily: T.mono, fontSize: 10, color: T.faint }}>{rows.length}</span>
                        </div>
                        {rows.map((r) => (
                            <PrRow key={r.pr.url} r={r} cursor={flat[cursor] === r} onOpen={() => openPr(r)} />
                        ))}
                    </div>
                ))}
                {model && model.groups.length === 0 && <span style={{ color: T.muted, fontSize: 13, padding: "0 12px" }}>Nothing open that concerns you.</span>}
            </div>
            <div style={{ flexShrink: 0, height: 30, padding: "0 26px", display: "flex", alignItems: "center", gap: 14, borderTop: `1px solid ${T.hairline}`, background: T.sidebar }}>
                <Key k="j k" label="row" />
                <Key k="⏎" label="open in browser pane" />
                <Key k="o" label="go to project" />
                <Key k="⇧⌘P" label="back" />
            </div>
        </div>
    );
});
PrQueue.displayName = "PrQueue";

function PrRow({ r, cursor, onOpen }: { r: QueueRow; cursor: boolean; onOpen: () => void }) {
    const { pr } = r;
    return (
        <div
            data-pr={`${pr.repo}#${pr.number}`}
            onClick={onOpen}
            style={{ display: "flex", alignItems: "center", gap: 16, height: 44, padding: "0 12px", borderRadius: 10, cursor: "pointer", background: cursor ? T.cardActive : "transparent", border: `1px solid ${cursor ? T.borderActive : "transparent"}` }}
        >
            <span style={{ width: 54, flexShrink: 0, fontFamily: T.mono, fontSize: 12.5, color: r.age.late ? T.brick : T.quietTitle }}>{r.age.text}</span>
            <span style={{ width: 118, flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 22, height: 22, borderRadius: "50%", background: r.mine ? "#4A3B2C" : "#332E2B", color: r.mine ? "#EFC9A5" : "#C9B9AC", fontFamily: T.mono, fontSize: 8.5, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {initials(pr.author)}
                </span>
                <span style={{ fontSize: 12, color: r.mine ? T.title : T.quietTitle, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.mine ? "you" : pr.author}</span>
            </span>
            <span style={{ width: 104, flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ display: "flex", gap: 2, width: 44 }}>
                    <span style={{ height: 5, borderRadius: 3, background: T.moss, flexGrow: Math.max(pr.additions, 0.5) }} />
                    <span style={{ height: 5, borderRadius: 3, background: T.brick, flexGrow: Math.max(pr.deletions, 0.5) }} />
                </span>
                <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.faint }}>{r.total}</span>
            </span>
            <span style={{ flexGrow: 1, minWidth: 0, fontSize: 13.5, color: T.title, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {pr.isDraft && <span style={{ fontSize: 10, border: `1px solid ${T.keycapBorder}`, borderRadius: 5, padding: "1px 5px", marginRight: 8, color: T.muted }}>draft</span>}
                {pr.title}
                {r.qualifier && <span style={{ fontSize: 11, color: r.qualifier.brick ? T.brick : T.muted }}> — {r.qualifier.text}</span>}
            </span>
            <span style={{ width: 150, flexShrink: 0, textAlign: "right", fontFamily: T.mono, fontSize: 10.5, color: T.faint }}>
                {r.repoShort} #{pr.number}
            </span>
        </div>
    );
}
