import { getLayoutModelForStaticTab } from "@/layout/index";
import { useAtomValue } from "jotai";
import { memo } from "react";
import { Key } from "./Key";
import { runAction } from "./menu";
import { HEADERS } from "./PrQueue";
import { T } from "./tokens";
import { useNow } from "./useNow";
import { useWintos } from "./useWintos";
import type { Lane } from "../daemon/sessions/reduce";
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
            {s.lane && (
                <div className="wintos-steps-row">
                    <StepTrack lane={s.lane} />
                </div>
            )}
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

const gate = (step: string) => step.startsWith("?");
const stepName = (step: string) => step.replace(/^\?\s*/, "");
// The panel vocabulary: moss is the machine working (the step now), apricot is you (your calls,
// ringed ahead, filled when it is now); done steps go quiet.
function stepColor(lane: Lane, i: number) {
    if (i < lane.at) return { dot: T.muted, ring: T.muted, text: T.muted };
    if (i === lane.at) return gate(lane.steps[i]) ? { dot: T.apricot, ring: T.apricot, text: T.apricot } : { dot: T.moss, ring: T.moss, text: T.title };
    return { dot: "transparent", ring: gate(lane.steps[i]) ? T.apricot : T.faint, text: T.faint };
}
const Dot = ({ c, size = 7 }: { c: { dot: string; ring: string }; size?: number }) => (
    <span style={{ display: "inline-block", width: size, height: size, flexShrink: 0, borderRadius: "50%", boxSizing: "border-box", background: c.dot, border: `1.5px solid ${c.ring}` }} />
);

// A narrow pane: the lane as one row. No room for every step, so it says how many are done,
// the one now, and the next that is your call (else simply the next one). The note gives way first.
function StepTrack({ lane }: { lane: Lane }) {
    const ahead = lane.steps.slice(lane.at + 1);
    const nextGate = ahead.findIndex(gate);
    const next = nextGate >= 0 ? lane.at + 1 + nextGate : ahead.length ? lane.at + 1 : -1;
    const step = (i: number, extra?: string) => {
        const c = stepColor(lane, i);
        return (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: c.text, fontWeight: i === lane.at ? 600 : 400, minWidth: 0, flexShrink: extra ? 1 : 0 }}>
                <Dot c={c} />
                <span style={{ flexShrink: 0 }}>{stepName(lane.steps[i])}</span>
                {extra && <span style={{ color: T.muted, fontWeight: 400, overflow: "hidden", textOverflow: "ellipsis" }}>· {extra}</span>}
            </span>
        );
    };
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", fontSize: 11 }}>
            <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.muted, border: `1px solid ${T.border}`, borderRadius: 4, padding: "0 5px", flexShrink: 0 }}>{lane.name}</span>
            {lane.at > 0 && <span style={{ color: T.faint, flexShrink: 0 }}>{lane.at}/{lane.steps.length}</span>}
            {step(lane.at, lane.note)}
            {next >= 0 && <span style={{ color: T.faint, flexShrink: 0 }}>→</span>}
            {next >= 0 && step(next)}
        </div>
    );
}

// A wide pane: the lane as a column beside the terminal.
export const SessionSteps = memo(({ blockId }: { blockId: string }) => {
    const { state } = useWintos();
    const lane = state ? sessionHeader(state, blockId)?.session.lane : undefined;
    if (!lane) return null;
    return (
        <div className="wintos-steps-side" data-wintos="session-steps" style={{ width: 210, flexShrink: 0, borderLeft: `1px solid ${T.border}`, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", fontFamily: T.ui }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", color: T.faint }}>{lane.name}</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {lane.steps.map((step, i) => {
                    const c = stepColor(lane, i);
                    return (
                        <div key={i} style={{ display: "flex", gap: 8, fontSize: 12.5, lineHeight: 1.35, color: c.text, fontWeight: i === lane.at ? 600 : 400 }}>
                            <span style={{ display: "flex", paddingTop: 4 }}>
                                <Dot c={c} size={9} />
                            </span>
                            <span>
                                {stepName(step)}
                                {i === lane.at && lane.note && <span style={{ display: "block", fontSize: 11, fontWeight: 400, color: T.muted }}>{lane.note}</span>}
                                {i >= lane.at && gate(step) && <span style={{ display: "block", fontSize: 11, fontWeight: 400, color: T.apricot }}>your call</span>}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
});
SessionSteps.displayName = "SessionSteps";
