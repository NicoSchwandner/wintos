import { useAtomValue } from "jotai";
import { memo, useEffect } from "react";
import type { KeyStats } from "../daemon/keyboard/keyboard";
import { Key } from "./Key";
import { noticeAtom, setLatestStreak, showNotice } from "./keyGame";
import { progress } from "./keyStats";
import { toggleView } from "./menu";
import { T } from "./tokens";

const BADGE_SEEN = "wintos:badge-seen";

// By the date: your rank and streak, and the key to the Keyboard page.
export const GameChip = memo(({ stats }: { stats: KeyStats }) => {
    const p = progress(stats);
    return (
        <button
            type="button"
            data-key="⇧⌘I"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => toggleView("keyboard")}
            title="Your keyboard rank and streak"
            style={{ WebkitAppRegion: "no-drag", display: "inline-flex", alignItems: "center", gap: 6, padding: "1px 2px 1px 6px", borderRadius: 6, border: `1px solid ${T.borderActive}`, background: "transparent", cursor: "pointer", fontFamily: T.mono, fontSize: 10, color: T.secondary } as React.CSSProperties}
        >
            <span style={{ color: T.moss }}>{p.rank}</span>
            <span>{stats.streak}</span>
            <Key k="⇧⌘I" label="" />
        </button>
    );
});
GameChip.displayName = "GameChip";

// Above the sidebar's keys: the way to the next rank, or for a while after a click that had a
// key, which key it was; after a new badge, the badge, in green and hard to miss.
export const GameLine = memo(({ stats }: { stats: KeyStats }) => {
    const notice = useAtomValue(noticeAtom);
    useEffect(() => void setLatestStreak(stats.streak), [stats.streak]);
    // A badge is announced once, by the window you're looking at (every project has its own).
    useEffect(() => {
        const announce = () => {
            const b = stats.badge;
            if (!b || document.visibilityState !== "visible") return;
            let seen = 0;
            try {
                seen = Number(localStorage.getItem(BADGE_SEEN)) || 0;
            } catch {}
            if (b.at <= seen || Date.now() - b.at > 86_400_000) return;
            try {
                localStorage.setItem(BADGE_SEEN, String(b.at));
            } catch {}
            showNotice({ kind: "badge", key: b.key, tier: b.tier, at: Date.now() });
        };
        announce();
        document.addEventListener("visibilitychange", announce);
        return () => document.removeEventListener("visibilitychange", announce);
    }, [stats.badge?.at]);

    const box: React.CSSProperties = { flexShrink: 0, padding: "7px 14px 8px", borderTop: `1px solid ${T.hairline}`, fontFamily: T.mono, fontSize: 10.5, display: "flex", flexDirection: "column", gap: 5 };
    if (notice?.kind === "badge")
        return (
            <div data-wintos="game-line" style={{ ...box, background: "#b8bb261f", borderTop: `1px solid ${T.moss}`, color: T.emphasis, animation: "wintos-badge 1.6s ease-in-out infinite" }}>
                <style>{`@keyframes wintos-badge { 0%,100% { box-shadow: inset 0 0 0 0 #b8bb2600 } 50% { box-shadow: inset 0 0 0 2px #b8bb2688 } } @media (prefers-reduced-motion: reduce) { [data-wintos=game-line] { animation: none !important } }`}</style>
                <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5 }}>
                    <span style={{ color: T.moss, fontWeight: 700 }}>New badge</span>
                    <Key k={notice.key} label={notice.tier} />
                </span>
            </div>
        );
    if (notice?.kind === "slip")
        return (
            <div data-wintos="game-line" style={{ ...box, color: T.muted }}>
                <span style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                    that was <Key k={notice.key} label="" /> {notice.streak > 0 ? `· streak ${notice.streak} → 0` : ""}
                </span>
            </div>
        );
    const p = progress(stats);
    return (
        <div data-wintos="game-line" style={{ ...box, color: T.faint }}>
            <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span>
                    {p.rank} · streak {stats.streak}
                </span>
                <span>{p.next ? `${p.toNext} to ${p.next}` : "top rank"}</span>
            </span>
            <div style={{ height: 3, borderRadius: 2, background: T.cardActive, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${p.pct}%`, background: T.moss }} />
            </div>
        </div>
    );
});
GameLine.displayName = "GameLine";
