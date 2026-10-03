import { memo } from "react";
import { RANKS } from "../daemon/keyboard/keyboard";
import { Key } from "./Key";
import { SECTIONS } from "./Keymap";
import { badges, neverUsed, progress, week } from "./keyStats";
import { T } from "./tokens";
import { useFocusOnMount } from "./useFocusOnMount";
import { useWintos } from "./useWintos";

const MEDAL = { gold: "#fabd2f", silver: "#bdae93", bronze: "#d79921" } as const;

// ⇧⌘I: the keyboard game in full. Your rank and the way to the next, the week's keys against
// clicks, what you click most and its key, the keys you've never used, and your badges.
export const KeyboardPage = memo(() => {
    const ref = useFocusOnMount<HTMLDivElement>();
    const { state } = useWintos();
    const s = state?.keyboard;
    const frame: React.CSSProperties = { flexGrow: 1, display: "flex", flexDirection: "column", gap: 16, padding: "18px 26px 20px", background: "#1d2021", outline: "none", fontFamily: T.ui, minWidth: 0, minHeight: 0, overflowY: "auto" };
    if (!s) return <div ref={ref} tabIndex={0} data-zone="list" data-wintos="keyboard" style={{ ...frame, color: T.muted }}>Waiting for wintosd.</div>;
    const p = progress(s);
    const days = week(s, Date.now());
    const weekKeys = days.reduce((n, d) => n + d.keys, 0);
    const weekClicks = days.reduce((n, d) => n + d.clicks, 0);
    const top = Math.max(1, ...days.map((d) => d.keys + d.clicks));
    const clicked = Object.entries(s.clicks).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const unused = neverUsed(SECTIONS, s);
    const earned = badges(s);
    return (
        <div ref={ref} tabIndex={0} data-zone="list" data-wintos="keyboard" style={frame}>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.muted }}>your rank</span>
                    <h1 style={{ margin: 0, fontFamily: T.display, fontSize: 34, fontWeight: 400, lineHeight: 1, color: T.emphasis }}>{p.rank}</h1>
                </div>
                <Key k="esc" label="back" />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 760 }}>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {RANKS.map(([name], i) => (
                        <span key={name} style={{ fontFamily: T.mono, fontSize: 10.5, padding: "2px 7px", borderRadius: 6, border: `1px solid ${i <= s.rank ? T.moss : i === s.rank + 1 ? "#fabd2f" : T.borderActive}`, background: i <= s.rank ? T.moss : "transparent", color: i <= s.rank ? T.ground : i === s.rank + 1 ? "#fabd2f" : T.muted }}>
                            {name}
                        </span>
                    ))}
                </div>
                <div style={{ height: 6, borderRadius: 3, background: T.cardActive, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${p.pct}%`, background: T.moss }} />
                </div>
                <span style={{ fontFamily: T.mono, fontSize: 11, color: T.muted }}>
                    {p.points} points · {p.next ? `${p.toNext} to ${p.next}` : "the top rank"} · streak {s.streak}, best {s.best}
                </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", alignItems: "start", gap: 14, maxWidth: 1100 }}>
                <Panel label="This week" note={weekKeys + weekClicks ? `${((weekKeys / (weekKeys + weekClicks)) * 100).toFixed(1)} % by key` : undefined}>
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 70 }}>
                        {days.map((d) => (
                            <div key={d.date} title={`${d.date}: ${d.keys} keys, ${d.clicks} clicks`} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%", gap: 1 }}>
                                <div style={{ height: `${(d.clicks / top) * 100}%`, background: T.apricot, borderRadius: "2px 2px 0 0" }} />
                                <div style={{ height: `${(d.keys / top) * 100}%`, background: T.moss, borderRadius: d.clicks ? 0 : "2px 2px 0 0" }} />
                            </div>
                        ))}
                    </div>
                    <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.muted }}>
                        {weekKeys} keys · {weekClicks} clicks
                    </span>
                </Panel>
                <Panel label="Clicked most" note="use the key instead">
                    {clicked.length ? clicked.map(([key, n]) => <Row key={key} k={key} text={`${n} click${n === 1 ? "" : "s"}`} />) : <Quiet>No clicks yet.</Quiet>}
                </Panel>
                <Panel label="Never used" note={`${unused.length} keys`}>
                    {unused.length ? unused.slice(0, 8).map(([k, what]) => <Row key={k} k={k} text={what} />) : <Quiet>You've used every key on the card.</Quiet>}
                </Panel>
                <Panel label="Badges" note={`${earned.length} earned`}>
                    {earned.length ? (
                        earned.slice(0, 10).map((b) => (
                            <div key={b.key} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, color: T.secondary }}>
                                <span style={{ width: 12, height: 12, borderRadius: "50%", background: MEDAL[b.tier], flexShrink: 0 }} />
                                <Key k={b.key} label={b.tier} />
                                <span style={{ marginLeft: "auto", fontFamily: T.mono, fontSize: 10.5, color: T.muted }}>{b.next ? `${b.count} / ${b.next}` : `${b.count}`}</span>
                            </div>
                        ))
                    ) : (
                        <Quiet>A key earns bronze at 10 uses, silver at 50, gold at 200.</Quiet>
                    )}
                </Panel>
            </div>
        </div>
    );
});
KeyboardPage.displayName = "KeyboardPage";

function Panel({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 9, padding: "12px 14px", background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", color: T.faint, textTransform: "uppercase" }}>{label}</span>
                {note && <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.muted }}>{note}</span>}
            </div>
            {children}
        </div>
    );
}

const Row = ({ k, text }: { k: string; text: string }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: T.secondary, minWidth: 0 }}>
        <Key k={k} label="" />
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text}</span>
    </div>
);
const Quiet = ({ children }: { children: React.ReactNode }) => <span style={{ fontSize: 12, color: T.faint }}>{children}</span>;
