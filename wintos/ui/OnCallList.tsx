import { memo, useState } from "react";
import { Key, KeyOr } from "./Key";
import { runAction } from "./menu";
import { pluginPanels } from "./panels";
import { T } from "./tokens";
import { useFocusOnMount } from "./useFocusOnMount";
import { useZoneKeys } from "./zones";
import { useNow } from "./useNow";
import { daemonFetch, useWintos } from "./useWintos";
import { relTime } from "./view";

// The Inbox's on-call list (⇧⌘O): every plugin panel's counts as rows. ⏎ or 1–9 opens a count's
// page as a browser pane beside the list, like a PR.
// pageOpen: a page is open beside the list, so Esc or ⌘L has somewhere to go.
export const OnCallList = memo(({ pageOpen }: { pageOpen: boolean }) => {
    const focusRef = useFocusOnMount<HTMLDivElement>();
    const { state } = useWintos();
    const now = useNow();
    const [cursor, setCursor] = useState(0);
    const panels = state ? pluginPanels(state) : [];
    const rows = panels.flatMap((p) => p.counts.map((c) => ({ panel: p, count: c })));
    const open = (i: number) => rows[i]?.count.url && runAction(`open-page:${rows[i].count.url}`);
    const resync = () => panels.forEach((p) => void daemonFetch(`/plugins/${encodeURIComponent(p.name)}/run`, { method: "POST", body: {} }).catch(() => {}));
    useZoneKeys(focusRef, {
        j: () => setCursor((c) => Math.min(c + 1, rows.length - 1)),
        k: () => setCursor((c) => Math.max(c - 1, 0)),
        Enter: () => void open(cursor),
        ...Object.fromEntries(["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => [d, () => void open(Number(d) - 1)])),
        r: (e) => void (e.repeat || resync()),
    });
    return (
        <div
            data-wintos="inbox-list"
            tabIndex={0}
            ref={focusRef}
            data-zone="list"
            style={{ flexGrow: 1, display: "flex", flexDirection: "column", background: T.ground, outline: "none", fontFamily: T.ui, minWidth: 0, minHeight: 0 }}
        >
            <div style={{ flexGrow: 1, overflowY: "auto", padding: "18px 26px", display: "flex", flexDirection: "column", gap: 18 }}>
                {panels.length === 0 && <span style={{ color: T.muted, fontSize: 13 }}>{state?.pluginNames?.length ? "Loading… the first run is still going." : "No on-call plugin is installed."}</span>}
                {panels.map((p) => (
                    <div key={p.name} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                            <span style={{ fontFamily: T.display, fontSize: 22, color: T.emphasis }}>{p.title}</span>
                            {p.subtitle && <span style={{ fontFamily: T.mono, fontSize: 11, color: T.muted }}>{p.subtitle}</span>}
                            <span style={{ marginLeft: "auto", fontSize: 11, color: p.error ? T.brick : T.faint }}>{p.error ? `last run failed: ${p.error}` : `${relTime(now - p.at)} ago`}</span>
                        </div>
                        {p.counts.map((c) => {
                            const i = rows.findIndex((r) => r.panel === p && r.count === c);
                            return (
                                <div
                                    key={c.label}
                                    data-key="j k ⏎"
                                    onClick={() => (setCursor(i), open(i))}
                                    style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 12px", borderRadius: 10, cursor: c.url ? "pointer" : "default", background: i === cursor ? T.cardActive : "transparent", border: `1px solid ${i === cursor ? T.borderActive : "transparent"}` }}
                                >
                                    {i < 9 && <Key k={String(i + 1)} label="" off={!c.url} />}
                                    <span style={{ width: 48, fontFamily: T.display, fontSize: 26, lineHeight: 1, color: c.count == null ? T.brick : T.text }}>{c.count ?? "?"}</span>
                                    <span style={{ fontSize: 13, color: T.secondary }}>{c.label}</span>
                                    <span style={{ marginLeft: "auto", fontSize: 11, color: c.count == null ? T.brick : T.muted }}>{c.note ?? ""}</span>
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
            <div style={{ flexShrink: 0, minHeight: 30, padding: "4px 26px", boxSizing: "border-box", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 14px", borderTop: `1px solid ${T.hairline}`, background: T.sidebar }}>
                <Key k="j k" label="row" />
                <Key k="⏎ 1–9" label="open" />
                <Key k="r" label="resync" />
                {pageOpen && <KeyOr keys={["esc", "⌘L"]} label="to the page" />}
            </div>
        </div>
    );
});
OnCallList.displayName = "OnCallList";
