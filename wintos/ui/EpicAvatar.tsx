import { memo } from "react";
import type { Look } from "./epicLook";
import "./epics.css";

// An epic's face at a size: the sidebar's rows (22), the pane frame's band (28), an epic's page (56).
export const EpicAvatar = memo(({ look, size = 22, title }: { look: Look; size?: number; title?: string }) => (
    <span
        data-wintos="epic-avatar"
        data-epic-glyph={look.glyph}
        title={title}
        style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: look.bg, boxShadow: `inset 0 0 0 1px ${look.ring}` }}
    >
        <svg width={Math.round(size * 0.6)} height={Math.round(size * 0.6)} viewBox="0 0 24 24" fill="none" stroke={look.fg} strokeWidth={size < 24 ? 2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={look.d} />
        </svg>
    </span>
));
EpicAvatar.displayName = "EpicAvatar";
