import { useFocusOnMount } from "./useFocusOnMount";
import { memo } from "react";
import { closeOverlay } from "./focus";
import { useZoneKeys } from "./zones";
import { KEYCAP_FONT } from "./Key";
import { T } from "./tokens";

// Only keys that exist. KeymapC lists a few more from the spec that are not built yet.
export const SECTIONS: [string, [string, string][]][] = [
    ["Projects", [["⌘J / ⌘K", "hold ⌘, tap to walk all projects, release to switch; esc right after: back"], ["⌘N", "new project"], ["⌘R", "rename this project"], ["⇧⌘W", "close this project (asks first while Claude runs)"], ["⌥⌘Z", "snooze this project: out of the sidebar and ⌘J/⌘K until it needs you or you open it"], ["⌥⌘P", "park: you read the turn and nothing is yours, it waits on something outside"], ["⇧⌘J", "join the meeting on now, else the next one (in the browser)"], ["⇧⌘Y", "today: plan the day, tick off its focus, in your daily journal"], ["⇧⌘I", "keyboard: your rank, streak, badges and the keys you haven't used"]]],
    ["Sessions", [["⌃⇥", "next that needs you: a waiting session, else a project"], ["⌘T / ⇧⌘T", "new terminal · new Claude session"], ["⌥⌘J / ⌥⌘K", "the pane below · above (a ⇧⌘D split)"], ["⌃⌘H/J/K/L", "move the pane left · down · up · right"], ["⌃⇧⇥", "back to where ⌃⇥ took you from"], ["⌘D / ⇧⌘D", "split the pane right · below"], ["⇧⌘B / ⇧⌘F", "new browser · files pane"], ["⇧⌘C", "copy a browser pane's url"], ["⌘F", "find in the focused pane"], ["⇧⌘R", "reload a browser pane"], ["⌘W / ⌘M", "close (a Claude session onto the shelf) · magnify the focused pane"], ["⌥⌘1–9", "a shelved session back, from the dock"]]],
    ["Open", [["⇧⌘P", "everything, including dropped projects"], ["⇧⌘L", "notes, full width"], ["⌥⌘L", "fold or unfold the notes rail"], ["⇧⌘G / ⇧⌘O", "the PRs tab · the On call tab; again goes back"], ["⌃N / ⌃P", "in ⇧⌘P: next · previous"], ["⇧⌘K", "this card"], ["⇧⌘U", "the focused page in your browser"], ["⌥⌘S", "show or hide the snoozed projects"], ["⌥⌘R ⌥⌘R", "restart the focused terminal (when it hangs)"], ["⌥⌘X", "tick off today's focus from anywhere"]]],
    ["Focus", [["⌘H / ⌘L", "one step left · right: pane to pane, then the notes; in PRs and On call the list, then its pages"], ["esc", "closes an overlay · a list back to its panes · an Inbox page back to its list"]]],
    ["Notes", [["⌘E / e", "edit mine.md, the only file you write"], ["⏎", "notes focused: full width, or the link under the cursor"], ["j / k", "notes focused: move over boxes and links"], ["x", "tick the box under the cursor (mine.md, today's focus)"], ["c", "today: carry the item under the cursor"], ["⌘⏎", "today: the plan is done"], ["m", "show more decisions · the ticked Built items"], ["1–9", "notes focused: open that PR beside the terminals"], ["⏎ / ⇥ / ⌘L", "editing: continue · indent a list, tick its box"], ["⌘⏎ / esc esc", "save · discard"]]],
    ["Queues", [["j / k", "row"], ["gg / G · ⌃D ⌃U", "first · last · half a page"], ["f", "PRs: filter, esc clears"], ["⏎ / o", "open the PR beside the list · its project, or a new one"], ["z", "snooze the PR until the next working day"], ["1–9", "on call: open that count's page"], ["r", "resync now"]]],
];

export const Keymap = memo(() => {
    const focusRef = useFocusOnMount<HTMLDivElement>();
    useZoneKeys(focusRef, { "Shift:?": closeOverlay });
    return (
        <div style={{ position: "absolute", inset: 0, zIndex: 100, background: "rgba(15,16,17,0.6)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={closeOverlay}>
            <div
                data-wintos="keymap"
                tabIndex={0}
                ref={focusRef}
                data-zone="overlay"
                onClick={(e) => e.stopPropagation()}
                style={{ width: 640, padding: "22px 26px", background: "#1d2021", border: `1px solid ${T.borderActive}`, borderRadius: 12, fontFamily: T.ui, outline: "none", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 32px" }}
            >
                <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "baseline", gap: 12 }}>
                    <span style={{ fontFamily: T.display, fontSize: 26, color: T.emphasis }}>Keys</span>
                    <span style={{ fontSize: 11.5, color: T.muted }}>⌘ keys work outside text fields · single letters act in the focused list</span>
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
