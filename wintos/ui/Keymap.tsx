import { useFocusOnMount } from "./useFocusOnMount";
import { useSetAtom } from "jotai";
import { memo } from "react";
import { overlayAtom } from "./notes/state";
import { KEYCAP_FONT } from "./Key";
import { T } from "./tokens";

// Only keys that exist. KeymapC lists a few more from the spec that are not built yet.
const SECTIONS: [string, [string, string][]][] = [
    ["Anywhere", [["⌘K", "everything, including dropped projects"], ["⌘/", "this card"], ["⌘1 ⌘2 ⌘3", "sidebar · terminal · notes"], ["⇧⌘P", "PRs by action"], ["⇧⌘O", "plugin panel (on call)"]]],
    ["Sidebar", [["j / k", "move, across bands"], ["⏎", "open project"], ["right-click", "open · rename · edit mine.md · close"]]],
    ["Sessions", [["⌃⇥", "next session waiting on you"], ["⇧⌘N", "new session in this project"], ["⌘W", "close the focused block"], ["⌘M", "magnify the focused block"]]],
    ["Notes", [["e", "edit mine.md, the only file you write"], ["⌘⏎ / esc", "save · discard"], ["⌘J", "both files, full width · again to close"]]],
    ["Queues", [["j / k", "row"], ["⏎ / o", "open the PR · go to its project"], ["1 / 2", "panel: focus a pane"], ["r", "resync now"]]],
];

export const Keymap = memo(() => {
    const focusRef = useFocusOnMount<HTMLDivElement>();
    const setOverlay = useSetAtom(overlayAtom);
    return (
        <div style={{ position: "absolute", inset: 0, zIndex: 100, background: "rgba(10,8,7,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setOverlay("")}>
            <div
                data-wintos="keymap"
                tabIndex={0}
                ref={focusRef}
                onKeyDown={(e) => (e.key === "Escape" || e.key === "?") && (e.preventDefault(), setOverlay(""))}
                onClick={(e) => e.stopPropagation()}
                style={{ width: 640, padding: "22px 26px", background: "#171413", border: `1px solid ${T.borderActive}`, borderRadius: 12, fontFamily: T.ui, outline: "none", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 32px" }}
            >
                <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "baseline", gap: 12 }}>
                    <span style={{ fontFamily: T.display, fontSize: 26, color: T.emphasis }}>Keys</span>
                    <span style={{ fontSize: 11.5, color: T.muted }}>single letters act on the cursor · ⌘ keys work anywhere</span>
                </div>
                {SECTIONS.map(([name, keys]) => (
                    <div key={name} style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", color: T.faint }}>{name}</span>
                        {keys.map(([k, what]) => (
                            <span key={k} style={{ display: "flex", gap: 10, fontSize: 12.5, color: T.secondary }}>
                                <span style={{ width: 96, flexShrink: 0, fontFamily: KEYCAP_FONT, fontSize: 12, color: T.keycapText }}>{k}</span>
                                {what}
                            </span>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
});
Keymap.displayName = "Keymap";
