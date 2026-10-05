import { useAtomValue } from "jotai";
import { memo, useEffect } from "react";
import { RANKS, type KeyStats } from "../daemon/keyboard/keyboard";
import { Key } from "./Key";
import { noticeAtom, setLatestStreak, showNotice } from "./keyGame";
import { progress } from "./keyStats";
import { openView } from "./menu";
import { mainViewAtom } from "./notes/state";
import { T } from "./tokens";

const SEEN = "wintos:badge-seen";

// Above the sidebar's keys: your rank, streak and the way to the next rank, with ⇧⌘I to the
// Keyboard page; for a while after a click that had a key, which key it was; after a new badge
// or rank, or today's focus all ticked, that, in green and hard to miss.
export const GameLine = memo(({ stats }: { stats: KeyStats }) => {
    const notice = useAtomValue(noticeAtom);
    const pageOpen = useAtomValue(mainViewAtom) === "keyboard";
    useEffect(() => void setLatestStreak(stats.streak), [stats.streak]);
    // A badge or a new rank is announced once, by the window you're looking at (every project has
    // its own), whichever is newest.
    useEffect(() => {
        const announce = () => {
            if (document.visibilityState !== "visible") return;
            const b = stats.badge;
            const l = stats.levelUp;
            const d = stats.dayDone;
            const events = [
                b && { at: b.at, notice: { kind: "badge" as const, key: b.key, tier: b.tier } },
                l && { at: l.at, notice: { kind: "rank" as const, rank: RANKS[l.rank][0] } },
                d && { at: d.at, notice: { kind: "done" as const } },
            ].filter((x): x is NonNullable<typeof x> => !!x);
            const newest = events.sort((x, y) => y.at - x.at)[0];
            if (!newest) return;
            let seen = 0;
            try {
                seen = Number(localStorage.getItem(SEEN)) || 0;
            } catch {}
            if (newest.at <= seen || Date.now() - newest.at > 86_400_000) return;
            try {
                localStorage.setItem(SEEN, String(newest.at));
            } catch {}
            showNotice({ ...newest.notice, at: Date.now() });
        };
        announce();
        document.addEventListener("visibilitychange", announce);
        return () => document.removeEventListener("visibilitychange", announce);
    }, [stats.badge?.at, stats.levelUp?.at, stats.dayDone?.at]);

    const box: React.CSSProperties = { flexShrink: 0, padding: "7px 14px 8px", borderTop: `1px solid ${T.hairline}`, fontFamily: T.mono, fontSize: 10.5, display: "flex", flexDirection: "column", gap: 5 };
    if (notice?.kind === "badge" || notice?.kind === "rank" || notice?.kind === "done")
        return (
            <div data-wintos="game-line" style={{ ...box, background: "#b8bb261f", borderTop: `1px solid ${T.moss}`, color: T.emphasis, animation: "wintos-badge 1.6s ease-in-out infinite" }}>
                <style>{`@keyframes wintos-badge { 0%,100% { box-shadow: inset 0 0 0 0 #b8bb2600 } 50% { box-shadow: inset 0 0 0 2px #b8bb2688 } } @media (prefers-reduced-motion: reduce) { [data-wintos=game-line] { animation: none !important } }`}</style>
                <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5 }}>
                    <span style={{ color: T.moss, fontWeight: 700 }}>{notice.kind === "badge" ? "New badge" : notice.kind === "rank" ? "New rank" : "All done today"}</span>
                    {notice.kind === "badge" && <Key k={notice.key} label={notice.tier} />}
                    {notice.kind === "rank" && <span style={{ fontFamily: T.display, fontSize: 17, color: T.emphasis }}>{notice.rank}</span>}
                    {notice.kind === "done" && <span style={{ color: T.emphasis }}>+10</span>}
                </span>
            </div>
        );
    if (notice?.kind === "slip")
        return (
            <div data-wintos="game-line" style={{ ...box, color: T.brick }}>
                <span style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                    that was <Key k={notice.key} label="" /> {notice.streak > 0 ? `· streak ${notice.streak} → 0` : ""}
                </span>
            </div>
        );
    const p = progress(stats);
    return (
        <div data-wintos="game-line" style={{ ...box, color: T.faint }}>
            <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <button
                    type="button"
                    data-key={pageOpen ? "" : "⇧⌘I"}
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => openView("keyboard")}
                    title="Your keyboard rank, streak and badges"
                    style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: 0, background: "transparent", border: "none", cursor: "pointer", fontFamily: T.mono, fontSize: 10.5, color: T.faint }}
                >
                    <span style={{ color: T.moss }}>{p.rank}</span>
                    <span>streak {stats.streak}</span>
                    <Key k="⇧⌘I" label="" />
                </button>
                <span>{p.next ? `${p.toNext} to ${p.next}` : "top rank"}</span>
            </span>
            <div style={{ height: 3, borderRadius: 2, background: T.cardActive, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${p.pct}%`, background: T.moss }} />
            </div>
        </div>
    );
});
GameLine.displayName = "GameLine";
