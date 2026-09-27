import { T } from "./tokens";

// Keycaps: SF Mono carries the Mac key symbols (⌘ ⇧ ⌃ ⏎ ⇥) that JetBrains Mono lacks.
export const KEYCAP_FONT = "'SF Mono', ui-monospace, Menlo, monospace";

export function Key({ k, label }: { k: string; label: string }) {
    return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontFamily: T.mono, fontSize: 11, color: T.muted, whiteSpace: "nowrap" }}>
            <span style={{ fontFamily: KEYCAP_FONT, fontSize: 11.5, lineHeight: 1, color: T.keycapText, background: T.keycapBg, border: `1px solid ${T.keycapBorder}`, borderBottomWidth: 2, borderRadius: 5, padding: "3px 7px" }}>{k}</span>
            {label}
        </span>
    );
}
