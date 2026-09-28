import { T } from "./tokens";

// Keycaps use the system font (SF Pro), the one macOS draws its own menu shortcuts in: its
// ⇧ ⌃ ⌥ are drawn at text weight, where SF Mono's hairline ⇧ nearly vanishes at 11px.
export const KEYCAP_FONT = "system-ui, -apple-system, sans-serif";

export function Key({ k, label }: { k: string; label: string }) {
    return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontFamily: T.mono, fontSize: 11, color: T.muted, whiteSpace: "nowrap" }}>
            <span style={{ fontFamily: KEYCAP_FONT, fontSize: 12, fontWeight: 500, letterSpacing: "0.04em", lineHeight: 1, color: T.keycapText, background: T.keycapBg, border: `1px solid ${T.keycapBorder}`, borderBottomWidth: 2, borderRadius: 5, padding: "3px 7px" }}>{k}</span>
            {label}
        </span>
    );
}
