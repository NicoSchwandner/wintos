import { getLayoutModelForStaticTab } from "@/layout/index";
import { useAtomValue } from "jotai";
import { memo } from "react";
import { Key } from "./Key";
import { runAction } from "./menu";
import { HEADERS } from "./PrQueue";
import { T } from "./tokens";
import { useNow } from "./useNow";
import { useWintos } from "./useWintos";
import { relTime, sessionHeader, urgentPr } from "./view";

const DOT = { working: T.moss, waiting: T.apricot, parked: T.muted, done: T.dim, idle: T.dim, ended: T.dim } as const;

// Above a Claude pane: its state, what it works on, its own status line and its PRs' verdicts.
export const SessionHeader = memo(({ blockId }: { blockId: string }) => {
    const { state } = useWintos();
    const now = useNow();
    const focused = useAtomValue(getLayoutModelForStaticTab().focusedNode)?.data?.blockId === blockId;
    const h = state ? sessionHeader(state, blockId) : undefined;
    if (!h) return null;
    const s = h.session;
    const urgent = urgentPr(h);
    return (
        <div data-wintos="session-header" style={{ position: "relative", flexShrink: 0, display: "flex", flexDirection: "column", gap: 5, padding: "7px 10px 8px 12px", borderBottom: `1px solid ${T.border}`, fontFamily: T.ui, fontSize: 12, minWidth: 0 }}>
            {h.tone && <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: h.tone === "brick" ? T.brick : T.apricot }} />}
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, whiteSpace: "nowrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: DOT[s.state] }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: DOT[s.state] }} />
                    {s.state}
                    {s.state !== "working" && ` ${relTime(now - s.since)}`}
                </span>
                {h.task && <span style={{ fontFamily: T.mono, fontSize: 11, color: T.title }}>{h.task}</span>}
                {h.branch && <span style={{ fontFamily: T.mono, fontSize: 11, color: T.muted, overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{h.branch}</span>}
            </div>
            {s.status && (
                <div style={{ color: T.secondary, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.status.text}>
                    {s.status.text}
                    <span style={{ fontFamily: T.mono, fontSize: 10, color: T.faint }}> · {relTime(now - s.status.at)}</span>
                </div>
            )}
            {h.prs.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                    {h.prs.map((p) => {
                        const head = p.group ? HEADERS[p.group] : undefined;
                        return (
                            <button
                                key={p.url}
                                type="button"
                                tabIndex={-1}
                                title={p.url}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => runAction(`open-page:${p.url}`)}
                                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 7px", borderRadius: 6, border: `1px solid ${head && p.group !== "waiting" && p.group !== "team" ? head.color : T.border}`, background: "transparent", cursor: "pointer", fontFamily: T.ui, fontSize: 11.5, whiteSpace: "nowrap" }}
                            >
                                <span style={{ fontFamily: T.mono, color: T.title }}>#{p.number}</span>
                                {head && <span style={{ color: head.color, fontWeight: 600 }}>{head.label}</span>}
                                {p.why && <span style={{ color: T.muted }}>{p.why}</span>}
                                {focused && p === urgent && <Key k="⌥⌘G" label="" />}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
});
SessionHeader.displayName = "SessionHeader";
