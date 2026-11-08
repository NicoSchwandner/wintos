import { useFocusOnMount } from "./useFocusOnMount";
import { memo } from "react";
import { closeOverlay } from "./focus";
import { useZoneKeys } from "./zones";
import { KEYCAP_FONT } from "./Key";
import { T } from "./tokens";

// Only keys that exist. KeymapC lists a few more from the spec that are not built yet.
export const SECTIONS: [string, [string, string][]][] = [
    ["Sessions", [["⌃⇥ / ⌃⇧⇥", "every session, what needs you first, then what has something to read, then the rest: hold ⌃, tap, release to switch"], ["⌘J / ⌘K", "walk the sidebar's rows one by one: hold ⌘, tap, release to switch; esc right after: back"], ["⌥⌘1–9", "the sidebar's row with that number"], ["⌘N", "new session: pick its epic (⌘1–9), say what it is for or ⏎ for the epic's next planned step; it starts in a view of its own"], ["⌘R", "name the focused session (yours sticks, or take the name it suggests); with no session focused, rename the project"], ["⇧⌘W", "close this project, its sessions shelved; ⇧⌘P opens it again on the newest (asks first while Claude runs)"], ["⌘Z", "undo the last pane or project closed, pause or PR snoozed"], ["⌥⌘P", "pause: you read the turn and nothing is yours, it waits on something outside"], ["⌥⌘M / ⌥⌘T", "move the session to another view (its epic's first) · out into a view of its own; it resumes there, so a running turn waits"], ["⇧⌘J", "join the meeting on now, else the next one (in the browser)"], ["⌥⌘Y", "reflect: write the week's (month's, quarter's, year's) reflection beside what it looks back on"], ["⇧⌘I", "keyboard: your rank, streak, badges and the keys you haven't used"]]],
    ["Epics", [["⇧⌘Y", "the epics home: your day, the daily, a card per epic, the month by epic (← → month, ⏎ on a row corrects its hours)"], ["⌥⌘E", "the focused session's epic: pick one (⌘1–9), ⌘0 for none, or type a name to start a new one"], ["⇧⌥⌘E", "the focused session's epic: its agent's terminal with the epic beside it; an epic without an agent yet opens on a page where a starts one"], ["⌥⌘V", "the sidebar by epic (each epic's agent is its header) or by state; again switches back"], ["a", "on an epic's page: its agent, which keeps the plan and roadmap and sees all its sessions; started in a view of its own the first time"], ["⌘L / ⌘H", "from the agent's terminal into the epic beside it, and back"], ["s · n", "on an epic: add a planned step · start a session"], ["⏎ · d", "on a step: go to its session or start one · done, or open again"], ["⇧J / ⇧K · e · ⌫ ⌫", "on a step: move it · rename it · remove it"], ["p · x", "on an epic's page: pin it to the top of the sidebar · the epic done"], ["m", "on an epic: show the finished sessions"]]],
    ["Sessions", [["⌘T", "new terminal"], ["⌘D / ⇧⌘D", "split the pane right · below"], ["⇧⌘C", "copy a browser pane's url"], ["⌘F", "find in the focused pane"], ["⌘R · ⇧⌘R", "in a browser pane: reload it · reload the whole WintOS window (when it hangs)"], ["⌘W / ⌘M", "close (a Claude session onto the shelf) · magnify the focused pane"], ["⌥⌘1–9", "the sidebar's rows, top to bottom: straight to that session's pane"], ["⌘L · j k · ⏎", "a session in the notes: back to its pane, or resumed from the shelf"], ["⌥⌘G", "the focused pane's most urgent PR, from its header"]]],
    ["Open", [["⇧⌘P", "everything, including dropped projects, the last touched first"], ["⌘↑", "palette: fold the group you expanded"], ["⌥⌘L", "fold or unfold the notes rail"], ["⇧⌘G / ⇧⌘O", "the PRs tab · the On call tab; again goes back"], ["⌃N / ⌃P", "in ⇧⌘P: next · previous"], ["⇧⌘K", "this card"], ["⌥⌘R ⌥⌘R", "restart the focused terminal (when it hangs)"], ["⌥⌘U", "update: rebuild and restart WintOS once its checkout has new commits (asks first while Claude works)"], ["⌥⌘B", "take a break now: what comes in waits; you are back at your next key"], ["⇧⌥⌘B", "the move nudge: ask again in 10 minutes"], ["⌥⌘S", "the quiet projects: show them, or fold them back to one line"]]],
    ["Focus", [["⌘H / ⌘L", "one step left · right: pane to pane, then the notes; in PRs and On call the list, then its pages"], ["esc", "closes an overlay · a list back to its panes · an Inbox page back to its list"]]],
    ["Notes", [["⌘E / e", "edit mine.md, the only file you write"], ["⏎", "notes focused: the link under the cursor"], ["j / k", "notes focused: move over boxes, links and heads-ups"], ["x", "tick the box under the cursor in mine.md, or close the heads-up"], ["c", "epics home: copy the month by epic as a table"], ["e", "epics home: edit the daily as a list, as mine.md: delete, move, rewrite or add a line"], ["m", "epics home: show the daily"], ["1–9", "notes focused: open that PR beside the terminals"], ["⏎ / ⇥ / ⌘L", "editing: continue · indent a list, tick its box"], ["⌘⏎ / esc esc", "save · discard"]]],
    ["Queues", [["j / k", "row"], ["gg / G · ⌃D ⌃U", "first · last · half a page"], ["/", "PRs: filter, esc clears"], ["f", "PRs: the row's next step: fix the conflict or red CI, work the review comments, review, re-review, or merge (f twice)"], ["⏎ / o", "open the PR beside the list · its project, or a new one"], ["z", "snooze the PR until the next working day"], ["n", "PRs: a short name for the row's repo, on every chip"], ["c", "your PR's red CI to the session that wrote it"], ["a", "conflicts on your PRs: fix them by themselves, or not"], ["1–9", "on call: open that count's page"], ["r", "resync now"]]],
];

export const Keymap = memo(() => {
    const focusRef = useFocusOnMount<HTMLDivElement>();
    useZoneKeys(focusRef, { "Shift:?": closeOverlay });
    return (
        <div style={{ position: "absolute", inset: 0, zIndex: 100, background: `color-mix(in srgb, ${T.ground} 70%, transparent)`, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={closeOverlay}>
            <div
                data-wintos="keymap"
                tabIndex={0}
                ref={focusRef}
                data-zone="overlay"
                onClick={(e) => e.stopPropagation()}
                // A short window gets more columns, then a scroll (↑↓, the card is focused), never a cut-off.
                style={{ width: "min(1040px, calc(100% - 32px))", maxHeight: "calc(100% - 32px)", overflowY: "auto", boxSizing: "border-box", padding: "22px 26px", background: T.ground, border: `1px solid ${T.borderActive}`, borderRadius: 12, fontFamily: T.ui, outline: "none" }}
            >
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 12px", marginBottom: 18 }}>
                    <span style={{ fontFamily: T.display, fontSize: 26, color: T.emphasis }}>Keys</span>
                    <span style={{ fontSize: 11.5, color: T.muted }}>⌘ keys work outside text fields · single letters act in the focused list</span>
                </div>
                <div style={{ columnWidth: 250, columnGap: 28 }}>
                {SECTIONS.map(([name, keys]) => (
                    <div key={name} style={{ display: "flex", flexDirection: "column", gap: 7, breakInside: "avoid", marginBottom: 18 }}>
                        <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.08em", color: T.faint }}>{name}</span>
                        {keys.map(([k, what]) => (
                            <span key={k} style={{ display: "flex", gap: 10, fontSize: 12.5, color: T.secondary }}>
                                <span style={{ width: 84, flexShrink: 0, fontFamily: KEYCAP_FONT, fontSize: 12, color: T.keycapText }}>{k}</span>
                                {what}
                            </span>
                        ))}
                    </div>
                ))}
                </div>
            </div>
        </div>
    );
});
Keymap.displayName = "Keymap";
