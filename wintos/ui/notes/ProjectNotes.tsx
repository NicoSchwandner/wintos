import { T } from "../tokens";
import { parseNotes, spans } from "./parse";

const DOT = { done: T.moss, partial: T.apricot, todo: "#3c3836" } as const;

export type Size = "rail" | "full";
const SIZES = {
    rail: { label: 10.5, text: 12.5, line: 1.55, gap: 6, textColor: T.quietTitle, code: 11.5 },
    full: { label: 11, text: 13.5, line: 1.6, gap: 9, textColor: T.secondary, code: 12.5 },
};

export function Rich({ text, size }: { text: string; size: Size }) {
    return (
        <>
            {spans(text).map((s, i) =>
                s.code ? (
                    <span key={i} style={{ fontFamily: T.mono, fontSize: SIZES[size].code, color: T.title }}>
                        {s.text}
                    </span>
                ) : (
                    <span key={i}>{s.text}</span>
                )
            )}
        </>
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
            <span style={{ textWrap: "pretty" } as React.CSSProperties}>{children}</span>
        </div>
    );
}

export function ProjectNotes({ md, size }: { md: string; size: Size }) {
    const n = parseNotes(md);
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
                    <p style={{ margin: 0, fontSize: size === "rail" ? 12.5 : 14, lineHeight: size === "rail" ? 1.6 : 1.65, color: z.textColor }}>
                        <Rich text={n.goal} size={size} />
                    </p>
                </Section>
            )}
            {n.decisions.length > 0 && (
                <Section label="Decisions" size={size}>
                    {n.decisions.map((d, i) => (
                        <Line
                            key={i}
                            size={size}
                            lead={<span style={{ fontFamily: T.mono, fontSize: size === "rail" ? 10 : 10.5, color: T.faint, flexShrink: 0, paddingTop: 3, width: size === "rail" ? undefined : 42 }}>{d.date ?? "·"}</span>}
                        >
                            <Rich text={d.text} size={size} />
                        </Line>
                    ))}
                </Section>
            )}
            {n.built.length > 0 && (
                <Section label="Built" size={size}>
                    {n.built.map((b, i) => (
                        <Line key={i} size={size} lead={dot(b.state ? DOT[b.state] : T.dim)}>
                            <Rich text={b.text} size={size} />
                        </Line>
                    ))}
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
                    <p style={{ margin: 0, fontSize: z.text, lineHeight: z.line, color: z.textColor, whiteSpace: "pre-wrap" }}>{o.text}</p>
                </Section>
            ))}
        </div>
    );
}
