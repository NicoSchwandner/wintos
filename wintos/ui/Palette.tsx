import { globalStore } from "@/app/store/jotaiStore";
import { atoms } from "@/store/global";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { closeOverlay, enterProject, focusSession, reopenProject, toggleOverlay } from "./focus";
import { liveSessions } from "./sessions";
import { runAction, runKey } from "./menu";
import { groupHits, searchPalette, type Field, type Hit, type Kind, type PaletteItem } from "./palette-search";
import { pluginPanels } from "./panels";
import { Key } from "./Key";
import { T } from "./tokens";
import { useNow } from "./useNow";
import { daemonFetch, useWintos } from "./useWintos";
import { useZoneKeys } from "./zones";
import { ghPrs, prProjects, projectTabIds, relTime, sidebarModel, withSnoozes, type WintosState } from "./view";
import { getWaveObjectAtom, makeORef } from "@/app/store/wos";

const KIND_LABEL: Record<Kind, string> = { project: "Projects", pr: "PRs", session: "Sessions", action: "Do" };
type Texts = Record<string, { body: string; mine: string }>;

// Task ids (DEV-29372) a project names in its title or notes.
const taskIds = (...texts: string[]) => [...new Set(texts.join(" ").match(/\b[A-Z]+-\d+\b/g) ?? [])].join(" ");

// The strip's "N shelved" opens the palette already searching.
let startQuery = "";
export function openPalette(q: string): void {
    startQuery = q;
    toggleOverlay("palette");
}

// ⇧⌘P: everything, including the projects the sidebar dropped and the closed ones (PaletteC).
export const Palette = memo(({ names }: { names: Record<string, string | undefined> }) => {
    const { state } = useWintos();
    const now = useNow();
    const [q, setQ] = useState(() => {
        const given = startQuery;
        startQuery = "";
        return given;
    });
    const [cursor, setCursor] = useState(0);
    const [expanded, setExpanded] = useState(new Set<Kind>());
    const [texts, setTexts] = useState<Texts>({});
    const ref = useRef<HTMLDivElement>(null);
    // The notes are read once per opening: searching them must not cost a fetch per key.
    useEffect(() => void daemonFetch("/projects/texts").then((r) => (r.ok ? r.json() : {})).then(setTexts, () => {}), []);

    const items = useMemo(() => (state ? paletteItems(state, texts, names, now) : []), [state, texts, names]);
    const hits = searchPalette(items, q);
    const rows = groupHits(hits, expanded);
    const run = (n: number) => {
        const row = rows[n];
        if (!row) return;
        if (row.type === "more") return setExpanded(new Set([...expanded, row.kind]));
        closeOverlay();
        row.hit.item.run?.(row.hit);
    };
    const down = () => setCursor((c) => Math.min(c + 1, rows.length - 1));
    const up = () => setCursor((c) => Math.max(c - 1, 0));
    useZoneKeys(ref, { ArrowDown: down, "Ctrl:n": down, ArrowUp: up, "Ctrl:p": up, Enter: () => run(cursor), "Shift:Cmd:p": closeOverlay });
    let lastKind = "";
    return (
        <div style={{ position: "absolute", inset: 0, zIndex: 100, background: "rgba(15,16,17,0.6)", display: "flex", justifyContent: "center", paddingTop: "12vh" }} onClick={closeOverlay}>
            <div
                data-wintos="palette"
                data-zone="overlay"
                ref={ref}
                onClick={(e) => e.stopPropagation()}
                style={{ width: 620, maxHeight: "64vh", display: "flex", flexDirection: "column", background: "#32302f", border: `1px solid ${T.borderActive}`, borderRadius: 12, boxShadow: "0 22px 52px rgba(0,0,0,0.72)", overflow: "hidden", fontFamily: T.ui }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: `1px solid ${T.hairline}` }}>
                    <span style={{ fontFamily: T.mono, color: T.apricot }}>&gt;</span>
                    <input
                        autoFocus
                        value={q}
                        placeholder="Search projects, notes, PRs, sessions and actions"
                        onChange={(e) => (setQ(e.target.value), setCursor(0), setExpanded(new Set()))}
                        style={{ flexGrow: 1, background: "transparent", border: "none", outline: "none", fontSize: 15, color: T.text, fontFamily: T.ui }}
                    />
                    <span style={{ fontFamily: T.mono, fontSize: 10, color: T.faint }}>{hits.length} of {items.length}</span>
                </div>
                <div style={{ overflowY: "auto", padding: "6px 8px 10px" }}>
                    {!rows.length && <div style={{ padding: "14px 10px", fontSize: 12.5, color: T.faint }}>Nothing matches “{q.trim()}”.</div>}
                    {rows.map((row, n) => {
                        const kind = row.type === "hit" ? row.hit.item.kind : row.kind;
                        const header = kind !== lastKind ? KIND_LABEL[kind] : null;
                        lastKind = kind;
                        const on = n === cursor;
                        return (
                            <div key={row.type === "hit" ? row.hit.item.id : `more:${row.kind}`}>
                                {header && <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", color: T.faint, padding: "10px 10px 4px" }}>{header}</div>}
                                <div
                                    ref={on ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
                                    onMouseEnter={() => setCursor(n)}
                                    data-key="↑ ↓ ⏎"
                                    onClick={() => run(n)}
                                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: row.type === "hit" ? "8px 10px" : "5px 10px", borderRadius: 8, cursor: "pointer", background: on ? "#3c3836" : "transparent" }}
                                >
                                    {row.type === "more" ? (
                                        <span style={{ fontSize: 11.5, color: on ? T.emphasis : T.muted }}>
                                            {row.count} more {row.kind === "pr" ? "PRs" : KIND_LABEL[row.kind].toLowerCase()}
                                        </span>
                                    ) : (
                                        <HitRow hit={row.hit} on={on} />
                                    )}
                                    {row.type === "hit" && row.hit.item.hint && <Key k={row.hit.item.hint} label="" />}
                                </div>
                            </div>
                        );
                    })}
                </div>
                <div style={{ display: "flex", gap: 14, padding: "8px 16px", borderTop: `1px solid ${T.hairline}`, fontSize: 11, color: T.faint }}>
                    <span>⏎ open</span>
                    <span>esc close</span>
                    <span style={{ marginLeft: "auto" }}>searches titles, PRs, task ids and the notes; closed projects reopen</span>
                </div>
            </div>
        </div>
    );
});
Palette.displayName = "Palette";

// The title with what matched marked; below it, the hit in the notes if that is where it was,
// else the usual subtitle.
function HitRow({ hit, on }: { hit: Hit; on: boolean }) {
    const { title, subtitle } = hit.item;
    const parts: { text: string; mark: boolean }[] = [];
    let at = 0;
    for (const [a, b] of hit.titleMarks ?? []) {
        if (a < at) continue;
        if (a > at) parts.push({ text: title.slice(at, a), mark: false });
        parts.push({ text: title.slice(a, b), mark: true });
        at = b;
    }
    parts.push({ text: title.slice(at), mark: false });
    const s = hit.snippet;
    const line: React.CSSProperties = { fontSize: 11, color: T.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
    return (
        <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span style={{ fontSize: 13, color: on ? T.emphasis : T.title, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {parts.map((p, i) => (p.mark ? <span key={i} style={{ color: T.apricot }}>{p.text}</span> : p.text))}
            </span>
            {s ? (
                <span style={line}>
                    <span style={{ fontFamily: T.mono, color: T.faint }}>{s.label}</span> {s.before}
                    <span style={{ color: T.apricot }}>{s.match}</span>
                    {s.after}
                </span>
            ) : (
                subtitle && <span style={line}>{subtitle}</span>
            )}
        </span>
    );
}

function paletteItems(state: WintosState, texts: Texts, names: Record<string, string | undefined>, now: number): PaletteItem[] {
    const ws = globalStore.get(atoms.workspace);
    const activeTab = globalStore.get(atoms.staticTabId);
    const ids = ws?.tabids ?? [];
    const tabIds = projectTabIds(ids, Object.fromEntries(ids.map((id) => [id, globalStore.get(getWaveObjectAtom<Tab>(makeORef("tab", id)))])));
    const model = withSnoozes(sidebarModel(tabIds, state), state.projectSnoozes);
    const project = (id: string) => state.projects.find((p) => p.id === id);
    const title = (id: string) => project(id)?.title ?? names[id] ?? "Untitled";
    const band: Record<string, string> = {};
    for (const r of model.needs) band[r.tabId] = "needs you";
    for (const r of model.running) band[r.tabId] = "running";
    for (const r of [...model.quiet, ...model.quietMore]) band[r.tabId] = "quiet";
    for (const r of model.quietStale) band[r.tabId] = `out of the sidebar · last touched ${relTime(now - r.lastAt)} ago`;
    for (const r of model.snoozed) band[r.tabId] = "snoozed · opening it wakes it";
    const gh = ghPrs(state);
    const prOf = prProjects(tabIds, state);
    const sessionsOf = (id: string) => state.sessions.filter((s) => s.tabId === id && s.state !== "ended");

    // A project is found by its title first, then its PRs and task ids, its next action, its
    // sessions, and last its notes. A hit in the notes opens them at the hit.
    const fields = (id: string): Field[] => {
        const p = project(id);
        const prs = gh?.prs.filter((pr) => p?.pr?.some((ref) => ref === `${pr.repo}#${pr.number}`)) ?? [];
        const t = texts[id] ?? { body: "", mine: "" };
        return [
            { text: [...(p?.pr ?? []), ...prs.map((pr) => pr.url), taskIds(p?.title ?? "", t.body)].join(" "), weight: 50, ids: true },
            ...prs.map((pr): Field => ({ text: pr.title, weight: 45, fuzzy: true, label: `#${pr.number}` })),
            { text: p?.next ?? "", weight: 40 },
            ...sessionsOf(id).map((s): Field => ({ text: s.label ?? "", weight: 30, fuzzy: true })),
            { text: t.body, weight: 10, label: "project.md" },
            { text: t.mine, weight: 12, label: "mine.md" },
        ];
    };
    const opens = (id: string) => (hit: Hit) => enterProject(id, hit.snippet && /\.md$/.test(hit.snippet.label) ? hit.snippet.match : undefined);

    const out: PaletteItem[] = tabIds.map((id) => ({
        id: `p:${id}`, kind: "project", title: title(id),
        subtitle: [band[id], project(id)?.next].filter(Boolean).join(" · "),
        fields: fields(id), recency: project(id)?.mtime, run: opens(id),
    }));
    // Closed: its folder is still there, its tab is not. Opening it reopens it in a new tab.
    for (const p of state.projects) {
        if (!p.id || !p.title || p.error || tabIds.includes(p.id) || ids.includes(p.id)) continue;
        out.push({ id: `c:${p.id}`, kind: "project", title: p.title, subtitle: ["closed · ⏎ reopens it", p.next].filter(Boolean).join(" · "), fields: fields(p.id), recency: (p.mtime ?? 0) / 2, run: () => reopenProject(p.id!) });
    }
    for (const pr of gh?.prs ?? []) {
        const tab = prOf.get(pr.url);
        out.push({
            id: `pr:${pr.url}`, kind: "pr", title: `#${pr.number} ${pr.title}`,
            subtitle: [pr.repo, tab ? title(tab) : "no project", pr.author === gh!.me ? "yours" : `by ${pr.author}`].join(" · "),
            fields: [{ text: `${pr.repo}#${pr.number} ${pr.url} ${taskIds(pr.title, pr.branch)}`, weight: 50, ids: true }, { text: pr.branch, weight: 30, fuzzy: true }],
            run: () => runAction(`open-page:${pr.url}`),
        });
    }
    // Only sessions whose pane is still there: a closed pane's session is on the shelf, or gone.
    const blocksOf = Object.fromEntries(tabIds.map((id) => [id, globalStore.get(getWaveObjectAtom<Tab>(makeORef("tab", id)))?.blockids ?? []]));
    for (const s of liveSessions(state.sessions, blocksOf).filter((s) => s.state !== "ended" && tabIds.includes(s.tabId)))
        out.push({ id: `s:${s.id}`, kind: "session", title: s.label ?? "session", subtitle: `${s.state} · ${title(s.tabId)}`, run: () => focusSession({ tabId: s.tabId, blockId: s.blockId }) });
    for (const id of tabIds)
        for (const s of state.shelf?.[id] ?? [])
            out.push({
                id: `sh:${s.sessionId}`, kind: "session", title: s.label,
                subtitle: [`shelved ${relTime(now - s.at)} ago`, title(id), s.gist].filter(Boolean).join(" · "),
                fields: [{ text: s.gist ?? "", weight: 25 }], recency: s.at,
                run: () => focusSession({ tabId: id, blockId: "", resume: s.script }),
            });
    const here = title(activeTab);
    // The key's own path (runKey), so an action does from here exactly what its key does.
    const action = (id: string, t: string, hint: string, a: string): PaletteItem => ({ id: `a:${id}`, kind: "action", title: t, hint, run: () => void runKey(a) });
    out.push(action("session", `New Claude session in ${here}`, "⇧⌘T", "session"));
    out.push(action("terminal", `New terminal in ${here}`, "⌘T", "terminal"));
    out.push(action("project", "New project", "⌘N", "project"));
    out.push(action("rename", `Rename ${here}`, "⌘R", "rename"));
    out.push(action("notes", `Notes for ${here}`, "⇧⌘L", "notes"));
    out.push(action("prs", "PRs need attention", "⇧⌘G", "prs"));
    for (const p of pluginPanels(state)) out.push(action(`panel:${p.name}`, p.title, "⇧⌘O", `panel:${p.name}`));
    out.push(action("close", `Close ${here}`, "⇧⌘W", "close-project"));
    out.push(action("day", "Today: plan the day", "⇧⌘Y", "day"));
    out.push(action("keyboard", "Keyboard: rank, streak, badges", "⇧⌘I", "keyboard"));
    out.push(action("join", "Join the meeting", "⇧⌘J", "join-meeting"));
    out.push(action("mine", `Edit mine.md of ${here}`, "⌘E", "edit-mine"));
    out.push(action("snooze", `Snooze or wake ${here}`, "⌥⌘Z", "snooze-project"));
    out.push(action("park", "Park the waiting session: nothing for you", "⌥⌘P", "park-session"));
    out.push(action("snoozed", "Show or hide the snoozed projects", "⌥⌘S", "show-snoozed"));
    out.push(action("copy-url", "Copy the focused page's url", "⇧⌘C", "copy-url"));
    out.push(action("external", "Open the focused page in your browser", "⇧⌘U", "open-external"));
    out.push(action("restart", "Restart the focused terminal", "⌥⌘R", "restart-terminal"));
    out.push(action("keys", "Keyboard shortcuts", "⇧⌘K", "keymap"));
    return out;
}
