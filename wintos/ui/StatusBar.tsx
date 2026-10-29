import { useAtomValue } from "jotai";
import { memo } from "react";
import { Key } from "./Key";
import { runKey } from "./menu";
import { mainViewAtom, updateArmedAtom, type MainView } from "./notes/state";
import { T } from "./tokens";
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

export const StatusBar = memo(() => {
    const view = useAtomValue(mainViewAtom);
    const behind = useWintos().state?.update?.behind ?? 0;
    const armed = useAtomValue(updateArmedAtom);
    return (
        <div style={{ flexShrink: 0, minHeight: 30, boxSizing: "border-box", padding: "5px 16px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 14px", borderTop: `1px solid ${T.hairline}`, background: T.sidebar, fontFamily: T.ui }}>
            {KEYS[view].map(([k, label]) => (
                <Key key={k} k={k} label={label} />
            ))}
            {behind > 0 && (
                <button type="button" data-wintos="update" data-key="⌥⌘U" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => runKey("update")} style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 7, padding: 0, background: "transparent", border: "none", cursor: "pointer", fontFamily: T.mono, fontSize: 11, color: armed ? T.brick : T.aqua }}>
                    <Key k="⌥⌘U" label="" />
                    {armed ? "again: restarting stops the sessions at work" : `update · ${behind} new commit${behind === 1 ? "" : "s"}`}
                </button>
            )}
        </div>
    );
});
StatusBar.displayName = "StatusBar";
