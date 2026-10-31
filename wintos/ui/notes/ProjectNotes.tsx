import { Key } from "../Key";
import { T } from "../tokens";
import { type CheckState } from "./checkbox";
import { Md } from "./Md";

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
export function Box({ state, size, onToggle, top }: { state: CheckState; size: Size; onToggle?: () => void; top?: number }) {
    const style: React.CSSProperties = {
        width: 12, height: 12, padding: 0, flexShrink: 0, marginTop: top ?? (size === "rail" ? 4 : 6), borderRadius: 3,
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

// A plain bullet among task boxes: a dot where a box would be.
export const Dot = () => <span data-bullet="" style={{ width: 12, flexShrink: 0, textAlign: "center", color: T.muted }}>•</span>;

export function More({ open, label, onClick }: { open: boolean; label: string; onClick: () => void }) {
    return (
        <button type="button" data-more={open ? "open" : "closed"} data-key="m" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={onClick} style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 8, padding: 0, background: "transparent", border: "none", fontFamily: T.ui, fontSize: 11.5, color: T.muted, cursor: "pointer" }}>
            {open ? "Show fewer" : label}
            <Key k="m" label="" />
        </button>
    );
}
