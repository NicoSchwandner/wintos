import { useAtomValue } from "jotai";
import { memo } from "react";
import { Key } from "./Key";
import { mainViewAtom } from "./notes/state";
import { T } from "./tokens";

// The keys that apply right now (spec §7), one row per view.
const KEYS = {
    terminal: [["⌘K", "everything"], ["⌃⇥", "next waiting"], ["⇧⌘N", "new session"], ["⌘J", "notes"], ["⇧⌘P", "PRs"], ["⇧⌘K", "keys"]],
    notes: [["e", "edit mine.md"], ["⌘⏎", "save"], ["esc", "discard"], ["⌘J", "back"]],
    prs: [["j k", "row"], ["⏎", "open"], ["o", "go to project"], ["r", "resync"], ["⇧⌘P", "back"]],
    panel: [["1 2", "focus a pane"], ["r", "resync"], ["esc", "back"]],
} as const;

export const StatusBar = memo(() => {
    const view = useAtomValue(mainViewAtom);
    if (view === "prs") return null; // the queue carries its own key bar (PRQueueC)
    return (
        <div style={{ flexShrink: 0, height: 30, padding: "0 16px", display: "flex", alignItems: "center", gap: 14, borderTop: `1px solid ${T.hairline}`, background: T.sidebar, fontFamily: T.ui }}>
            {KEYS[view].map(([k, label]) => (
                <Key key={k} k={k} label={label} />
            ))}
        </div>
    );
});
StatusBar.displayName = "StatusBar";
