import { useAtomValue } from "jotai";
import { memo } from "react";
import { Key } from "./Key";
import { mainViewAtom } from "./notes/state";
import { T } from "./tokens";

// The keys that apply right now (spec §7), one row per view. Only keys with no element of their
// own on screen: a key shown where it acts (⌘J/⌘K on the open project, ⌘E on mine.md, ⇧⌘G on
// the PRs card, ⌃⇥ in the sidebar, the notes view's own) is not repeated here.
const KEYS = {
    terminal: [["⇧⌘P", "everything"], ["⇧⌘T", "new session"], ["⇧⌘L", "notes"], ["⇧⌘K", "keys"]],
    notes: [],
} as const;

export const StatusBar = memo(() => {
    const view = useAtomValue(mainViewAtom);
    return (
        <div style={{ flexShrink: 0, height: 30, padding: "0 16px", display: "flex", alignItems: "center", gap: 14, borderTop: `1px solid ${T.hairline}`, background: T.sidebar, fontFamily: T.ui }}>
            {KEYS[view].map(([k, label]) => (
                <Key key={k} k={k} label={label} />
            ))}
        </div>
    );
});
StatusBar.displayName = "StatusBar";
