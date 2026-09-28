import { useFocusOnMount } from "./useFocusOnMount";
import { focusArea } from "./focus";
import { useAtomValue } from "jotai";
import { memo, useRef } from "react";
import { Key } from "./Key";
import { panelNameAtom } from "./notes/state";
import { pluginPanels } from "./panels";
import { T } from "./tokens";
import { useNow } from "./useNow";
import { daemonFetch, useWintos } from "./useWintos";
import { relTime } from "./view";

// A plugin's panel full width (OnCallC): its counts, then each url live side by side.
export const PanelView = memo(() => {
    const focusRef = useFocusOnMount<HTMLDivElement>();
    const { state } = useWintos();
    const now = useNow();
    const name = useAtomValue(panelNameAtom);
    const panes = useRef<(HTMLElement | null)[]>([]);
    const panel = state ? pluginPanels(state).find((p) => p.name === name) : undefined;
    if (!panel) return <div style={{ flexGrow: 1, padding: 26, color: T.muted, fontFamily: T.ui, background: "#171413" }}>This panel is not available right now.</div>;
    const withUrl = panel.counts.filter((c) => c.url);
    const resync = () => daemonFetch(`/plugins/${encodeURIComponent(panel.name)}/run`, { method: "POST", body: {} }).catch(() => {});
    return (
        <div
            data-wintos="panel-view"
            tabIndex={0}
            ref={focusRef}
            onKeyDown={(e) => {
                const n = Number(e.key);
                if (n >= 1 && n <= withUrl.length) panes.current[n - 1]?.focus();
                else if (e.key === "r" && !e.repeat) void resync();
                else if (e.key === "Escape") focusArea("terminal");
                else return;
                e.preventDefault();
            }}
            style={{ flexGrow: 1, display: "flex", flexDirection: "column", background: "#171413", outline: "none", fontFamily: T.ui, minWidth: 0 }}
        >
            <div style={{ padding: "18px 26px 14px", display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
                    <h1 style={{ margin: 0, fontFamily: T.display, fontSize: 30, fontWeight: 400, lineHeight: 1, color: T.emphasis }}>{panel.title}</h1>
                    {panel.subtitle && <span style={{ fontFamily: T.mono, fontSize: 11, color: T.muted }}>{panel.subtitle}</span>}
                </div>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11, color: panel.error ? T.brick : T.faint }}>
                    {panel.error ? `last run failed: ${panel.error}` : `${relTime(now - panel.at)} ago`}
                    <Key k="r" label="resync" />
                </span>
            </div>
            <div style={{ padding: "0 26px 14px", display: "flex", gap: 12 }}>
                {panel.counts.map((c, i) => (
                    <div key={c.label} style={{ flexGrow: 1, flexBasis: 0, padding: "14px 16px", background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                        <span style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                            <span style={{ fontFamily: T.display, fontSize: 34, lineHeight: 1, color: c.count == null ? T.brick : T.text }}>{c.count ?? "?"}</span>
                            <span style={{ fontSize: 12.5, color: T.secondary }}>{c.label}</span>
                        </span>
                        <span style={{ fontSize: 11, color: c.count == null ? T.brick : T.muted }}>{c.note ?? " "}</span>
                        {c.url && <Key k={String(withUrl.indexOf(c) + 1)} label="focus pane" />}
                    </div>
                ))}
            </div>
            <div style={{ flexGrow: 1, padding: "0 26px 20px", display: "flex", gap: 12, minHeight: 0 }}>
                {withUrl.map((c, i) => (
                    <div key={c.url} style={{ flexGrow: 1, flexBasis: 0, display: "flex", flexDirection: "column", border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
                        <div style={{ padding: "7px 12px", fontFamily: T.mono, fontSize: 10.5, color: T.muted, background: T.sidebar, borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.url}</div>
                        {/* The default session, like Wave's web blocks, so browser logins are shared. */}
                        <webview ref={(el: HTMLElement | null) => void (panes.current[i] = el)} src={c.url} style={{ flexGrow: 1 }} />
                    </div>
                ))}
            </div>
        </div>
    );
});
PanelView.displayName = "PanelView";
