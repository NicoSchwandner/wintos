import { T } from "./tokens";

// Keycaps use the system font (SF Pro), the one macOS draws its own menu shortcuts in: its
// ⇧ ⌃ ⌥ are drawn at text weight, where SF Mono's hairline ⇧ nearly vanishes at 11px.
export const KEYCAP_FONT = "system-ui, -apple-system, sans-serif";

// off: the key does nothing right now (e.g. "go to project" on a PR without one).
export function Key({ k, label, off }: { k: string; label: string; off?: boolean }) {
    return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontFamily: T.mono, fontSize: 11, color: T.muted, whiteSpace: "nowrap", opacity: off ? 0.35 : 1 }}>
            <span style={{ fontFamily: KEYCAP_FONT, fontSize: 12, fontWeight: 500, letterSpacing: "0.04em", lineHeight: 1, color: T.keycapText, background: T.keycapBg, border: `1px solid ${T.keycapBorder}`, borderBottomWidth: 2, borderRadius: 5, padding: "3px 7px" }}>{k}</span>
            {label}
        </span>
    );
}

// Two keys that do the same thing, shown as two caps with "or" between: "esc" "⌘L" read as one
// combination otherwise.
export function KeyOr({ keys, label }: { keys: string[]; label: string }) {
    return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontFamily: T.mono, fontSize: 11, color: T.muted, whiteSpace: "nowrap" }}>
            {keys.map((k, i) => (
                <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                    {i > 0 && "or"}
                    <Key k={k} label="" />
                </span>
            ))}
            {label}
        </span>
    );
}
