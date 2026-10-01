import { useState } from "react";
import { T } from "../tokens";
import { type CheckState } from "./checkbox";
import { Md } from "./Md";
import { parseNotes } from "./parse";


export type Size = "rail" | "full";
export const SIZES = {
    rail: { label: 10.5, text: 12.5, line: 1.55, gap: 6, textColor: T.quietTitle, code: 11.5 },
    full: { label: 11, text: 13.5, line: 1.6, gap: 9, textColor: T.secondary, code: 12.5 },
};

export function Rich({ text, size, links = true }: { text: string; size: Size; links?: boolean }) {
    return <Md text={text} size={size} inline links={links} />;
}

// A task box: done filled green with a tick, partial half-filled, todo empty. Clickable only
// where the file is the developer's (mine.md), as a real button so ⇥ and Space reach it.
export function Box({ state, size, onToggle }: { state: CheckState; size: Size; onToggle?: () => void }) {
    const style: React.CSSProperties = {
        width: 12, height: 12, padding: 0, flexShrink: 0, marginTop: size === "rail" ? 4 : 6, borderRadius: 3,
        border: `1.5px solid ${state === "done" ? T.moss : state === "partial" ? T.apricot : T.muted}`,
        background: state === "done" ? T.moss : state === "partial" ? `linear-gradient(90deg, ${T.apricot} 50%, transparent 50%)` : "transparent",
        display: "inline-flex", alignItems: "center", justifyContent: "center", color: T.ground, fontSize: 9, fontWeight: 700, lineHeight: 1,
        cursor: onToggle ? "pointer" : "default",
    };
    const mark = state === "done" ? "✓" : "";
    if (!onToggle) return <span style={style}>{mark}</span>;
    return (
        <button type="button" onClick={onToggle} title={state === "done" ? "Untick" : "Tick"} aria-label={state === "done" ? "Untick" : "Tick"} style={style}>
            {mark}
        </button>
    );
}

function Section({ label, size, children }: { label: string; size: Size; children: React.ReactNode }) {
    const z = SIZES[size];
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: z.gap }}>
            <span style={{ fontSize: z.label, fontWeight: 700, letterSpacing: "0.08em", color: T.faint }}>{label}</span>
            {children}
        </div>
    );
}

function Line({ lead, size, children }: { lead: React.ReactNode; size: Size; children: React.ReactNode }) {
    const z = SIZES[size];
    return (
        <div style={{ display: "flex", gap: size === "rail" ? 9 : 11, fontSize: z.text, lineHeight: z.line, color: z.textColor }}>
            {lead}
            <span style={{ textWrap: "pretty", minWidth: 0, overflowWrap: "anywhere" } as React.CSSProperties}>{children}</span>
        </div>
    );
}

// Long lists stay short: past this many, the rest (later decisions, ticked Built items) wait behind a button.
const LONG = 4;

function More({ open, label, onClick }: { open: boolean; label: string; onClick: () => void }) {
    return (
        <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={onClick} style={{ alignSelf: "flex-start", padding: 0, background: "transparent", border: "none", fontFamily: T.ui, fontSize: 11.5, color: T.muted, cursor: "pointer" }}>
            {open ? "Show fewer" : label}
        </button>
    );
}

export function ProjectNotes({ md, size }: { md: string; size: Size }) {
    const n = parseNotes(md);
    const [allDecisions, setAllDecisions] = useState(false);
    const [allBuilt, setAllBuilt] = useState(false);
    const decisions = allDecisions ? n.decisions : n.decisions.slice(0, LONG);
    const checked = n.built.length > LONG ? n.built.filter((b) => b.state === "done").length : 0;
    const built = allBuilt || !checked ? n.built : n.built.filter((b) => b.state !== "done");
    const z = SIZES[size];
    const dot = (color: string) => (
        <span style={{ width: size === "rail" ? 6 : 7, height: size === "rail" ? 6 : 7, borderRadius: "50%", background: color, flexShrink: 0, marginTop: size === "rail" ? 6 : 8 }} />
    );
    const empty = !n.goal && !n.decisions.length && !n.built.length && !n.questions.length && !n.other.length;
    if (empty) return <span style={{ fontSize: z.text, color: T.faint }}>Nothing written yet. The sessions fill this in as the work moves.</span>;
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: size === "rail" ? 12 : 20 }}>
            {n.goal && (
                <Section label="Goal" size={size}>
                    <Md text={n.goal} size={size} />
                </Section>
            )}
            {n.decisions.length > 0 && (
                <Section label="Decisions" size={size}>
                    {decisions.map((d, i) => (
                        <Line
                            key={i}
                            size={size}
                            lead={<span style={{ fontFamily: T.mono, fontSize: size === "rail" ? 10 : 10.5, color: T.faint, flexShrink: 0, paddingTop: 3, width: size === "rail" ? undefined : 42 }}>{d.date ?? "·"}</span>}
                        >
                            <Rich text={d.text} size={size} />
                        </Line>
                    ))}
                    {n.decisions.length > LONG && <More open={allDecisions} label={`Show ${n.decisions.length - LONG} more`} onClick={() => setAllDecisions(!allDecisions)} />}
                </Section>
            )}
            {n.built.length > 0 && (
                <Section label="Built" size={size}>
                    {built.map((b, i) => (
                        <Line key={i} size={size} lead={b.state ? <Box state={b.state} size={size} /> : dot(T.dim)}>
                            <Rich text={b.text} size={size} />
                        </Line>
                    ))}
                    {checked > 0 && <More open={allBuilt} label={`Show ${checked} checked`} onClick={() => setAllBuilt(!allBuilt)} />}
                </Section>
            )}
            {n.questions.length > 0 && (
                <Section label="Open questions" size={size}>
                    {n.questions.map((q, i) => (
                        <Line key={i} size={size} lead={<span style={{ color: T.apricot, flexShrink: 0 }}>?</span>}>
                            <Rich text={q.text} size={size} />
                            {q.blocking && <span style={{ color: T.apricot, fontWeight: 600 }}> Blocking.</span>}
                        </Line>
                    ))}
                </Section>
            )}
            {n.other.map((o, i) => (
                <Section key={i} label={o.heading || "Notes"} size={size}>
                    <Md text={o.text} size={size} />
                </Section>
            ))}
        </div>
    );
}
