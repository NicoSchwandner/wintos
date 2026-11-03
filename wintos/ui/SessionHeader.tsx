import { getLayoutModelForStaticTab } from "@/layout/index";
import { useAtomValue } from "jotai";
import { GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from "lucide-react";
import { memo } from "react";
import { decisions } from "./decisions";
import { Key } from "./Key";
import { runAction, runKey } from "./menu";
import { HEADERS } from "./PrQueue";
import { SESSION_DOT, T } from "./tokens";
import { useNow } from "./useNow";
import { daemonFetch, useWintos } from "./useWintos";
import { wakesWhen } from "../daemon/wakes/wakes";
import { liveSubagents, type Lane } from "../daemon/sessions/reduce";
import { shownState } from "./sessions";
import { WhereWasI } from "./WhereWasI";
import { prRef, relTime, sessionHeader, sessionName, urgentPr, type PrChip, type PrStatus } from "./view";


// Above a Claude pane: its state, what it works on, its own status line and its PRs' verdicts.
export const SessionHeader = memo(({ blockId }: { blockId: string }) => {
    const { state } = useWintos();
    const now = useNow();
    const focused = useAtomValue(getLayoutModelForStaticTab().focusedNode)?.data?.blockId === blockId;
    const h = state ? sessionHeader(state, blockId) : undefined;
    if (!h) return null;
    const s = h.session;
    const shown = shownState(s, now);
    const agents = liveSubagents(s, now);
    const urgent = urgentPr(h);
    // In a session waiting on you: how many more wait, and the key to the next.
    const waiting = focused && state ? decisions(state, now, () => "") : [];
    const more = waiting.some((d) => d.sessionId === s.id) ? waiting.length - 1 : 0;
    const units = state?.projects.find((p) => p.id === s.tabId)?.units ?? [];
    const at = units.findIndex((u) => u.state === "current");
    const unitAt = at >= 0 ? { i: at + 1, n: units.length, name: units[at].name } : undefined;
    return (
        <div data-wintos="session-header" style={{ position: "relative", flexShrink: 0, display: "flex", flexDirection: "column", gap: 5, padding: "7px 10px 8px 12px", borderBottom: `1px solid ${T.border}`, fontFamily: T.ui, fontSize: 12, minWidth: 0 }}>
            {h.tone && <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: h.tone === "brick" ? T.brick : T.apricot }} />}
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, whiteSpace: "nowrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: SESSION_DOT[shown] }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: SESSION_DOT[shown] }} />
                    {shown}
                    {shown !== s.state ? ` · ${agents} subagent${agents === 1 ? "" : "s"}` : s.state !== "working" && ` ${relTime(now - s.since)}`}
                </span>
                <span data-wintos="session-name" style={{ color: T.emphasis, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, flexShrink: 1 }}>{sessionName(s)}</span>
                {s.name?.by === "session" && now - s.name.at < NAME_PROPOSAL_MS && <NameButton label={`change the name · ${Math.min(60, Math.ceil((NAME_PROPOSAL_MS - (now - s.name.at)) / 1000))}s`} />}
                {s.name?.suggested && <NameButton label={`it suggests “${s.name.suggested}”`} />}
                {more > 0 && (
                    <button type="button" data-wintos="walk-next" data-key="⌥⌘O" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => runKey("release")} style={{ flexShrink: 0, marginLeft: "auto", order: 9, padding: 0, background: "transparent", border: "none", cursor: "pointer" }}>
                        <Key k="⌥⌘O" label={`next waiting · ${more} more`} always />
                    </button>
                )}
                {h.task && <span style={{ fontFamily: T.mono, fontSize: 11, color: T.title }}>{h.task}</span>}
                {h.branch && <span style={{ fontFamily: T.mono, fontSize: 11, color: T.muted, overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{h.branch}</span>}
            </div>
            <WhereWasI sessionId={s.id} focused={focused} />
            {(s.lane || unitAt) && (
                <div className="wintos-steps-row">
                    <StepTrack lane={s.lane} unit={unitAt} />
                </div>
            )}
            {s.status && (
                <div style={{ color: T.secondary, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.status.text}>
                    {s.status.text}
                    <span style={{ fontFamily: T.mono, fontSize: 11, color: T.faint }}> · {relTime(now - s.status.at)}</span>
                </div>
            )}
            {h.wake && (
                <div data-wintos="session-wake" style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, color: T.blue, whiteSpace: "nowrap" }} title={h.wake.prompt}>
                    <span style={{ flexShrink: 0 }}>{h.wake.due ? "wakes now" : wakesWhen(h.wake, state && prRef(state, h.wake.pr))}:</span>
                    <span style={{ color: T.secondary, overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{h.wake.prompt}</span>
                    {h.moreWakes && <span style={{ flexShrink: 0, color: T.muted }}>· {h.moreWakes} more</span>}
                    <button
                        type="button"
                        data-wintos="wake-cancel"
                        tabIndex={-1}
                        title={h.moreWakes ? "cancel its wakes" : "cancel the wake"}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => void daemonFetch(`/blocks/${encodeURIComponent(blockId)}/wake/cancel?session=${encodeURIComponent(s.id)}`, { method: "POST", body: {} }).catch(() => {})}
                        style={{ flexShrink: 0, padding: "0 4px", background: "transparent", border: "none", cursor: "pointer", color: T.muted, fontSize: 13, lineHeight: 1 }}
                    >
                        ×
                    </button>
                </div>
            )}
            {/* One line: the most urgent few; the rest are in the notes' Sessions. */}
            {h.prs.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
                    {h.prs.slice(0, HEADER_CHIPS).map((p) => <PrChipButton key={p.url} chip={p} keyHint={focused && p === urgent ? "⌥⌘G" : undefined} />)}
                    {h.prs.length > HEADER_CHIPS && <span style={{ flexShrink: 0, fontFamily: T.mono, fontSize: 11, color: T.muted }}>+{h.prs.length - HEADER_CHIPS}</span>}
                </div>
            )}
        </div>
    );
});
SessionHeader.displayName = "SessionHeader";

const HEADER_CHIPS = 4;

const NameButton = ({ label }: { label: string }) => (
    <button type="button" data-key="⌥⌘N" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => runKey("name-session")} style={{ flexShrink: 0, padding: 0, background: "transparent", border: "none", cursor: "pointer", textDecoration: "underline dotted", textUnderlineOffset: 3 }}>
        <Key k="⌥⌘N" label={label} />
    </button>
);

// The session's own name stands unless you change it within this minute (the session carries on).
const NAME_PROPOSAL_MS = 60_000;

// GitHub's own PR icons. Green and red are already moss (a machine working) and brick (rotting)
// here, so open is aqua and closed goes quiet.
const STATUS_ICON: Record<PrStatus, { Icon: typeof GitPullRequest; color: string }> = {
    draft: { Icon: GitPullRequestDraft, color: T.secondary },
    open: { Icon: GitPullRequest, color: T.aqua },
    merged: { Icon: GitMerge, color: T.purple },
    closed: { Icon: GitPullRequestClosed, color: T.muted },
};

// One PR as a chip: its status, number and what is next, in its queue group's colour; a click opens the PR.
export function PrChipButton({ chip: p, keyHint, small }: { chip: PrChip; keyHint?: string; small?: boolean }) {
    const head = p.group ? HEADERS[p.group] : undefined;
    const loud = !!head && p.group !== "waiting" && p.group !== "team";
    const icon = p.status && STATUS_ICON[p.status];
    return (
        <button
            type="button"
            tabIndex={-1}
            data-status={p.status}
            title={p.status ? `${p.status} · ${p.url}` : p.url}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => runAction(`open-page:${p.url}`)}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: small ? "1px 6px" : "2px 7px", borderRadius: 6, border: `1px solid ${loud ? head.color : T.border}`, background: "transparent", cursor: "pointer", fontFamily: T.ui, fontSize: small ? 10.5 : 11.5, whiteSpace: "nowrap", flexShrink: 0 }}
        >
            {icon && <icon.Icon size={small ? 13 : 14} strokeWidth={2.5} style={{ flexShrink: 0, color: icon.color }} />}
            <span style={{ fontFamily: T.mono, color: T.title }}>{p.repo ? `${p.repo} ` : ""}#{p.number}</span>
            {p.text && <span style={{ color: loud ? head.color : T.muted }}>{p.text}</span>}
            {keyHint && <Key k={keyHint} label="" />}
        </button>
    );
}

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
// unit: which of the project's units this is (i of n), beside the lane.
function StepTrack({ lane, unit }: { lane?: Lane; unit?: { i: number; n: number; name: string } }) {
    const unitChip = unit && <span data-wintos="unit-of" title={unit.name} style={{ fontFamily: T.mono, fontSize: 11.5, color: T.muted, flexShrink: 0 }}>unit {unit.i}/{unit.n}</span>;
    if (!lane) return <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", fontSize: 11 }}>{unitChip}<span style={{ color: T.secondary, overflow: "hidden", textOverflow: "ellipsis" }}>{unit!.name}</span></div>;
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
            {unitChip}
            <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.muted, border: `1px solid ${T.border}`, borderRadius: 4, padding: "0 5px", flexShrink: 0 }}>{lane.name}</span>
            {lane.at > 0 && <span style={{ color: T.faint, flexShrink: 0 }}>{lane.at}/{lane.steps.length}</span>}
            {step(lane.at, [lane.note, lane.todos && `${lane.todos.filter((t) => t.done).length}/${lane.todos.length}`].filter(Boolean).join(" · ") || undefined)}
            {next >= 0 && <span style={{ color: T.faint, flexShrink: 0 }}>→</span>}
            {next >= 0 && step(next)}
        </div>
    );
}

// A wide pane: the project's units of work and the session's lane, as a column beside the
// terminal. The unit being worked on holds the lane under it; done ones go quiet, the rest follow.
export const SessionSteps = memo(({ blockId }: { blockId: string }) => {
    const { state } = useWintos();
    const s = state ? sessionHeader(state, blockId)?.session : undefined;
    const lane = s?.lane;
    const units = (s && state?.projects.find((p) => p.id === s.tabId)?.units) ?? [];
    if (!lane && !units.length) return null;
    const current = units.findIndex((u) => u.state === "current");
    return (
        <div className="wintos-steps-side" data-wintos="session-steps" style={{ width: 210, flexShrink: 0, borderLeft: `1px solid ${T.border}`, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", fontFamily: T.ui }}>
            {units.length > 0 ? (
                <>
                    <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.08em", color: T.faint }}>UNITS · {units.filter((u) => u.state === "done").length}/{units.length}</span>
                    <div data-wintos="project-units" style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                        {units.map((u, i) => (
                            <div key={i} data-unit={u.state} style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                                <div style={{ display: "flex", gap: 8, fontSize: 12.5, lineHeight: 1.35, color: u.state === "current" ? T.emphasis : T.faint, fontWeight: u.state === "current" ? 600 : 400 }}>
                                    <span style={{ fontFamily: T.mono, flexShrink: 0, width: 9, color: u.state === "done" ? T.moss : u.state === "current" ? T.moss : T.faint }}>{u.state === "done" ? "✓" : u.state === "current" ? "▸" : "○"}</span>
                                    <span style={{ minWidth: 0, overflowWrap: "anywhere", textDecoration: u.state === "done" ? "line-through" : undefined }}>{u.name}</span>
                                </div>
                                {i === current && lane && (
                                    <div style={{ marginLeft: 6, paddingLeft: 10, borderLeft: `1px solid ${T.border}` }}>
                                        <LaneSteps lane={lane} />
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                    {current < 0 && lane && <LaneSteps lane={lane} />}
                </>
            ) : (
                lane && <LaneSteps lane={lane} />
            )}
        </div>
    );
});
// The lane's name and its steps; the step now carries its note, its to-dos and whether it is your call.
function LaneSteps({ lane }: { lane: Lane }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.08em", color: T.faint }}>{lane.name}</span>
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
                                {i === lane.at && lane.todos && (
                                    <span style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 4, fontSize: 11.5, fontWeight: 400 }}>
                                        {lane.todos.map((t, k) => (
                                            <span key={k} style={{ display: "flex", gap: 6, color: t.done ? T.faint : T.secondary, textDecoration: t.done ? "line-through" : undefined }}>
                                                <span style={{ fontFamily: T.mono, color: t.done ? T.moss : T.faint }}>{t.done ? "✓" : "○"}</span>
                                                {t.text}
                                            </span>
                                        ))}
                                    </span>
                                )}
                                {i >= lane.at && gate(step) && <span style={{ display: "block", fontSize: 11, fontWeight: 400, color: T.apricot }}>your call</span>}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
SessionSteps.displayName = "SessionSteps";
