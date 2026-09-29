import { memo } from "react";
import { Key } from "../Key";
import { runAction } from "../menu";
import { HEADERS } from "../PrQueue";
import { T } from "../tokens";
import { useWintos } from "../useWintos";
import { projectPrList } from "../view";

// The project's PRs in its notes. 1–9 (with the notes focused) or a click opens one in a
// browser pane of the project.
export const PR_KEYS = 9;
export const openProjectPr = (tabId: string, state: ReturnType<typeof useWintos>["state"], n: number): boolean => {
    const r = state ? projectPrList(state, tabId)[n - 1] : undefined;
    if (r) runAction(`open-page:${r.pr.url}`);
    return !!r;
};

export const PrList = memo(({ tabId, size }: { tabId: string; size: "rail" | "full" }) => {
    const { state } = useWintos();
    const rows = state ? projectPrList(state, tabId) : [];
    if (!rows.length) return null;
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.secondary }}>pull requests</span>
            {rows.map((r, i) => (
                <div
                    key={r.pr.url}
                    onClick={() => runAction(`open-page:${r.pr.url}`)}
                    title={r.pr.url}
                    style={{ display: "flex", alignItems: "baseline", gap: 8, cursor: "pointer", opacity: r.snoozed ? 0.55 : 1, fontSize: size === "rail" ? 12 : 13, lineHeight: 1.4 }}
                >
                    {i < PR_KEYS && <Key k={String(i + 1)} label="" />}
                    <span style={{ flexShrink: 0, fontFamily: T.mono, fontSize: 10.5, color: T.muted }}>#{r.pr.number}</span>
                    <span style={{ minWidth: 0, flexGrow: 1, color: T.title, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.pr.title}</span>
                    <span style={{ flexShrink: 0, maxWidth: size === "rail" ? "45%" : undefined, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10.5, color: HEADERS[r.group].color }}>
                        {r.snoozed ? "snoozed" : HEADERS[r.group].label}
                        {r.note && <span style={{ color: T.faint }}> · {r.note}</span>}
                    </span>
                </div>
            ))}
        </div>
    );
});
PrList.displayName = "PrList";
