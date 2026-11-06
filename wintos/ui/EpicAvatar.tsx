import { memo } from "react";
import type { Look } from "./epicLook";
import "./epics.css";

// An epic's face at a size: the sidebar's rows (22), the pane frame's band (28), an epic's page (56).
// running: its agent is at work, shown as a ring turning around the face (epics.css).
export const EpicAvatar = memo(({ look, size = 22, title, running }: { look: Look; size?: number; title?: string; running?: boolean }) => (
    <span
        data-wintos="epic-avatar"
        data-epic-glyph={look.glyph}
        data-agent-running={running || undefined}
        className={running ? "w-agent-run" : undefined}
        title={running ? `${title ? `${title} · ` : ""}its agent is working` : title}
        style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: look.bg, boxShadow: `inset 0 0 0 1px ${look.ring}`, ["--w-run" as string]: look.fg } as React.CSSProperties}
    >
        <svg width={Math.round(size * 0.6)} height={Math.round(size * 0.6)} viewBox="0 0 24 24" fill="none" stroke={look.fg} strokeWidth={size < 24 ? 2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={look.d} />
        </svg>
    </span>
));
EpicAvatar.displayName = "EpicAvatar";
