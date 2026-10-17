import { useAtomValue } from "jotai";
import { memo } from "react";
import { Key } from "./Key";
import { mainViewAtom, type MainView } from "./notes/state";
import { T } from "./tokens";

// The keys that apply right now (spec §7), one row per view. Only keys with no element of their
// own on screen: a key shown where it acts (⌘J/⌘K on the open project, ⌘E on mine.md, ⇧⌘G on
// the PRs card, ⌃⇥ in the sidebar, the notes view's own) is not repeated here.
// The full-page views (notes, day) show their own keys. Typed by view, so a new one can't be missed.
const KEYS: Record<MainView, readonly (readonly [string, string])[]> = {
    terminal: [["⇧⌘P", "everything"], ["⇧⌘T", "new session"], ["⇧⌘L", "notes"], ["⇧⌘K", "keys"]],
    notes: [],
    day: [],
    keyboard: [],
};

export const StatusBar = memo(() => {
    const view = useAtomValue(mainViewAtom);
    return (
        <div style={{ flexShrink: 0, minHeight: 30, boxSizing: "border-box", padding: "5px 16px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 14px", borderTop: `1px solid ${T.hairline}`, background: T.sidebar, fontFamily: T.ui }}>
            {KEYS[view].map(([k, label]) => (
                <Key key={k} k={k} label={label} />
            ))}
        </div>
    );
});
StatusBar.displayName = "StatusBar";
