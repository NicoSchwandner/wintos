import { globalStore } from "@/app/store/jotaiStore";
import { atoms, getApi } from "@/store/global";
import { useSetAtom } from "jotai";
import { memo, useMemo, useState } from "react";
import { focusSession } from "./focus";
import { runAction } from "./menu";
import { mainViewAtom, overlayAtom } from "./notes/state";
import { searchPalette, type PaletteItem } from "./palette-search";
import { pluginPanels } from "./panels";
import { T } from "./tokens";
import { useNow } from "./useNow";
import { useWintos } from "./useWintos";
import { prsByTab, relTime, sidebarModel } from "./view";

const KIND_LABEL = { project: "Projects", session: "Sessions", action: "Do" } as const;

// ⌘K: everything, including the projects the sidebar dropped (PaletteC).
export const Palette = memo(({ names }: { names: Record<string, string | undefined> }) => {
    const { state } = useWintos();
    const now = useNow();
    const setOverlay = useSetAtom(overlayAtom);
    const [q, setQ] = useState("");
    const [cursor, setCursor] = useState(0);

    const items = useMemo((): PaletteItem[] => {
        if (!state) return [];
        const ws = globalStore.get(atoms.workspace);
        const activeTab = globalStore.get(atoms.staticTabId);
        const tabIds = ws?.tabids ?? [];
        const model = sidebarModel(tabIds, state);
        const title = (id: string) => state.projects.find((p) => p.id === id)?.title ?? names[id] ?? "Untitled";
        const band: Record<string, string> = {};
        for (const r of model.needs) band[r.tabId] = "needs you";
        for (const r of model.running) band[r.tabId] = "running";
        for (const r of [...model.quiet, ...model.quietMore]) band[r.tabId] = "quiet";
        for (const r of model.quietStale) band[r.tabId] = `out of the sidebar · last touched ${relTime(now - r.lastAt)} ago`;
        const out: PaletteItem[] = tabIds.map((id) => ({
            id: `p:${id}`, kind: "project", title: title(id),
            subtitle: [band[id], state.projects.find((p) => p.id === id)?.next].filter(Boolean).join(" · "),
            run: () => (globalStore.set(mainViewAtom, "terminal"), getApi().setActiveTab(id)),
        }));
        for (const s of state.sessions.filter((s) => s.state !== "ended" && tabIds.includes(s.tabId)))
            out.push({ id: `s:${s.id}`, kind: "session", title: s.label ?? "session", subtitle: `${s.state} · ${title(s.tabId)}`, run: () => focusSession({ tabId: s.tabId, blockId: s.blockId }) });
        const here = title(activeTab);
        const pr = prsByTab([activeTab], state)[activeTab]?.items[0]?.pr;
        out.push({ id: "a:session", kind: "action", title: `New session in ${here}`, hint: "⇧⌘N", run: () => runAction("session") });
        if (pr) out.push({ id: "a:pr", kind: "action", title: `Open PR #${pr.number} in a browser pane`, hint: "", run: () => runAction(`open-url:${pr.url}`) });
        out.push({ id: "a:notes", kind: "action", title: `Notes for ${here}`, hint: "⌘J", run: () => runAction("notes") });
        out.push({ id: "a:prs", kind: "action", title: "PRs need attention", hint: "⇧⌘P", run: () => runAction("prs") });
        for (const p of pluginPanels(state)) out.push({ id: `a:panel:${p.name}`, kind: "action", title: p.title, hint: "⇧⌘O", run: () => runAction(`panel:${p.name}`) });
        out.push({ id: "a:close", kind: "action", title: `Close ${here}`, hint: "⇧⌘W", run: () => void getApi().closeTab(ws!.oid, activeTab, true) });
        out.push({ id: "a:keys", kind: "action", title: "Keyboard shortcuts", hint: "⇧⌘K", run: () => runAction("keymap") });
        return out;
    }, [state, names]);

    const results = searchPalette(items, q);
    const run = (i: PaletteItem | undefined) => {
        if (!i) return;
        setOverlay("");
        i.run?.();
    };
    let lastKind = "";
    return (
        <div style={{ position: "absolute", inset: 0, zIndex: 100, background: "rgba(10,8,7,0.55)", display: "flex", justifyContent: "center", paddingTop: "12vh" }} onClick={() => setOverlay("")}>
            <div
                data-wintos="palette"
                onClick={(e) => e.stopPropagation()}
                style={{ width: 620, maxHeight: "64vh", display: "flex", flexDirection: "column", background: "#1C1918", border: `1px solid ${T.borderActive}`, borderRadius: 12, boxShadow: "0 22px 52px rgba(0,0,0,0.72)", overflow: "hidden", fontFamily: T.ui }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: `1px solid ${T.hairline}` }}>
                    <span style={{ fontFamily: T.mono, color: T.apricot }}>&gt;</span>
                    <input
                        autoFocus
                        value={q}
                        placeholder="Search projects, sessions and actions"
                        onChange={(e) => (setQ(e.target.value), setCursor(0))}
                        onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Escape") setOverlay("");
                            else if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) setCursor((c) => Math.min(c + 1, results.length - 1));
                            else if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) setCursor((c) => Math.max(c - 1, 0));
                            else if (e.key === "Enter") run(results[cursor]);
                            else return;
                            e.preventDefault();
                        }}
                        style={{ flexGrow: 1, background: "transparent", border: "none", outline: "none", fontSize: 15, color: T.text, fontFamily: T.ui }}
                    />
                    <span style={{ fontFamily: T.mono, fontSize: 10, color: T.faint }}>{results.length} of {items.length}</span>
                </div>
                <div style={{ overflowY: "auto", padding: "6px 8px 10px" }}>
                    {results.map((i, n) => {
                        const header = i.kind !== lastKind ? KIND_LABEL[i.kind] : null;
                        lastKind = i.kind;
                        return (
                            <div key={i.id}>
                                {header && <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", color: T.faint, padding: "10px 10px 4px" }}>{header}</div>}
                                <div
                                    onMouseEnter={() => setCursor(n)}
                                    onClick={() => run(i)}
                                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "8px 10px", borderRadius: 8, cursor: "pointer", background: n === cursor ? "#2E2825" : "transparent" }}
                                >
                                    <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                                        <span style={{ fontSize: 13, color: n === cursor ? T.emphasis : T.title, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i.title}</span>
                                        {i.subtitle && <span style={{ fontSize: 11, color: T.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i.subtitle}</span>}
                                    </span>
                                    {i.hint && <span style={{ fontFamily: T.mono, fontSize: 10, color: T.muted }}>{i.hint}</span>}
                                </div>
                            </div>
                        );
                    })}
                </div>
                <div style={{ display: "flex", gap: 14, padding: "8px 16px", borderTop: `1px solid ${T.hairline}`, fontSize: 11, color: T.faint }}>
                    <span>⏎ open</span>
                    <span>esc close</span>
                    <span style={{ marginLeft: "auto" }}>reaches the projects the sidebar has dropped</span>
                </div>
            </div>
        </div>
    );
});
Palette.displayName = "Palette";
