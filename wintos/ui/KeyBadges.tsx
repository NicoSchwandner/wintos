import { memo, useEffect, useState } from "react";
import { capStyle } from "./Key";

// The chrome whose buttons are badged: the surfaces that hide their inline caps (theme.css).
const SURFACES = ["sidebar", "pane-strip", "session-header", "notes-rail", "notes-drawer"].map((s) => `[data-wintos="${s}"]`).join(",");
const TARGETS = `:is(${SURFACES}) [data-key]:not([data-key=""]):not([data-nobadge]), [data-wintos="notes-drawer"][data-key]`;

type Badge = { k: string; x: number; y: number };

// While ⌘ is held: every button's key as a cap on its top-right corner, over the layout rather
// than in it, so holding ⌘ moves nothing.
export const KeyBadges = memo(() => {
    const [badges, setBadges] = useState<Badge[]>([]);
    useEffect(() => {
        const sync = () => {
            if (!document.body.classList.contains("w-show-keys")) return setBadges([]);
            const out: Badge[] = [];
            for (const el of document.querySelectorAll<HTMLElement>(TARGETS)) {
                const r = el.getBoundingClientRect();
                if (r.width && r.height) out.push({ k: el.dataset.key!, x: r.right, y: r.top });
            }
            setBadges(out);
        };
        const obs = new MutationObserver(sync);
        obs.observe(document.body, { attributes: true, attributeFilter: ["class"] });
        return () => obs.disconnect();
    }, []);
    if (!badges.length) return null;
    return (
        <div data-wintos="key-badges" style={{ position: "fixed", inset: 0, zIndex: 1000, pointerEvents: "none" }}>
            {badges.map((b, i) => (
                <span key={i} style={{ ...capStyle, position: "absolute", left: b.x, top: b.y, transform: "translate(-85%, -80%)", whiteSpace: "nowrap", boxShadow: "0 2px 6px rgba(0,0,0,0.25)" }}>
                    {b.k}
                </span>
            ))}
        </div>
    );
});
KeyBadges.displayName = "KeyBadges";
