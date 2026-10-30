import { useAtomValue } from "jotai";
import { memo } from "react";
import { Key } from "./Key";
import { runKey } from "./menu";
import { mainViewAtom, updateArmedAtom, type MainView } from "./notes/state";
import { T } from "./tokens";
import { atWork } from "./sessions";
import { useNow } from "./useNow";
import { useWintos } from "./useWintos";

// The keys that apply right now (spec §7), one row per view. Only keys with no element of their
// own on screen: a key shown where it acts (⌘J/⌘K on the open project, ⌘E on mine.md, ⇧⌘G on
// the PRs card, ⌃⇥ in the sidebar) is not repeated here.
// The full-page views (Today, Reflect) show their own keys. Typed by view, so a new one can't be missed.
const KEYS: Record<MainView, readonly (readonly [string, string])[]> = {
    terminal: [["⇧⌘P", "everything"], ["⇧⌘T", "new session"], ["⌥⌘L", "notes"], ["⇧⌘K", "keys"]],
    day: [],
    reflect: [],
    keyboard: [],
};

const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

// "2 turns in flight and 1 subagent", or "" when nothing is at work.
export const atWorkText = ({ working, subagents }: { working: number; subagents: number }) =>
    [working && `${working} turn${working === 1 ? "" : "s"} in flight`, subagents && `${subagents} subagent${subagents === 1 ? "" : "s"}`].filter(Boolean).join(" and ");

// On every view, so ⌥⌘U is seen wherever you are; inbox: the Inbox tabs have their own key
// footer, so here only the update shows, and an empty bar is not drawn.
export const StatusBar = memo(({ inbox }: { inbox?: boolean }) => {
    const view = useAtomValue(mainViewAtom);
    const { state } = useWintos();
    const behind = state?.update?.behind ?? 0;
    const armed = useAtomValue(updateArmedAtom);
    const now = useNow(state?.rhythm?.onBreak ? 1000 : 60_000);
    const work = atWorkText(atWork(state?.sessions ?? [], now));
    const keys = inbox ? [] : KEYS[view];
    const onBreak = state?.rhythm?.onBreak;
    if (!keys.length && !behind && !onBreak) return null;
    return (
        <div style={{ flexShrink: 0, minHeight: 30, boxSizing: "border-box", padding: "5px 16px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 14px", borderTop: `1px solid ${T.hairline}`, background: T.sidebar, fontFamily: T.ui }}>
            {keys.map(([k, label]) => (
                <Key key={k} k={k} label={label} />
            ))}
            {onBreak && (
                <span data-wintos="on-break" style={{ fontFamily: T.mono, fontSize: 11, color: T.moss }}>
                    on a break · {clock(now - onBreak)}
                </span>
            )}
            {behind > 0 && (
                <button type="button" data-wintos="update" data-key="⌥⌘U" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => runKey("update")} style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 7, padding: 0, background: "transparent", border: "none", cursor: "pointer", fontFamily: T.mono, fontSize: 11, color: armed ? T.brick : T.aqua }}>
                    <Key k="⌥⌘U" label="" />
                    {armed ? `again: restarting stops ${work}` : `update · ${behind} new commit${behind === 1 ? "" : "s"}`}
                    {!armed && work && <span data-wintos="update-busy" style={{ color: T.apricot }}>· {work} would stop</span>}
                </button>
            )}
        </div>
    );
});
StatusBar.displayName = "StatusBar";
