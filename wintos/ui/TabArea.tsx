import { getWaveObjectAtom, makeORef } from "@/app/store/wos";
import { atoms } from "@/store/global";
import { getLayoutModelForStaticTab } from "@/layout/index";
import { atom, useAtomValue } from "jotai";
import { memo, useEffect, useMemo } from "react";
import { ConfirmClose } from "./ConfirmClose";
import { NameSession } from "./NameSession";
import { EpicPicker } from "./EpicPicker";
import { NewStep } from "./NewStep";
import { MoveSession } from "./MoveSession";
import { useFocusReport } from "./useFocusReport";
import "./theme.css";
import { Key } from "./Key";
import { Keymap } from "./Keymap";
import { useSeenReporter } from "./useSeenReporter";
import { useNewProjectPaste } from "./newproject";
import { useWintos } from "./useWintos";
import { KeyBadges } from "./KeyBadges";
import { UndoToast } from "./UndoToast";
import { NotesRail } from "./notes/NotesRail";
import { isPage, mainViewAtom, overlayAtom } from "./notes/state";
import { Palette } from "./Palette";
import { InboxArea } from "./InboxArea";
import { inboxKind, isInboxTab } from "./view";
import { PaneStrip } from "./PaneStrip";
import { MoveNudge } from "./MoveNudge";
import { closeProjectTab, runKey } from "./menu";
import { StatusBar } from "./StatusBar";
import { T } from "./tokens";
import { ReflectionPage } from "./ReflectionPage";
import { TodayPage } from "./TodayPage";
import { KeyboardPage } from "./KeyboardPage";

// The project area: session strip over the terminals, the notes rail beside them, and the Today
// and keyboard pages in the terminals' place. Terminals stay mounted underneath.
export const WintosTabArea = memo(({ tabId, children }: { tabId: string; children: React.ReactNode }) => {
    const view = useAtomValue(mainViewAtom);
    const overlay = useAtomValue(overlayAtom);
    const names = useTabNames();
    useSeenReporter(tabId);
    useFocusReport();
    const tab = useAtomValue(useMemo(() => getWaveObjectAtom<Tab>(makeORef("tab", tabId)), [tabId]));
    // The last pane closing leaves blockids null, not [].
    const empty = !!tab && !tab.blockids?.length;
    const { state } = useWintos();
    const inbox = isInboxTab(tab);
    useNewProjectPaste(tabId, inbox ? undefined : tab?.blockids, state ?? undefined);
    useMagnifyFollowsFocus();
    return (
        <div className="flex flex-col flex-grow min-w-0" style={{ position: "relative" }}>
            {/* ⇧⌘Y's page covers a project and an Inbox tab alike; what is under it stays mounted. */}
            {view === "day" && <TodayPage />}
            {view === "reflect" && <ReflectionPage />}
            {view === "keyboard" && <KeyboardPage />}
            <div className="flex flex-col flex-grow min-w-0" style={{ minHeight: 0, display: isPage(view) ? "none" : "flex" }}>
            {inbox ? (
                <InboxArea tabId={tabId} list={inboxKind(tab)!} empty={empty}>
                    {children}
                </InboxArea>
            ) : (
            <>
            <div className="flex flex-row flex-grow min-w-0" style={{ minHeight: 0 }}>
                <div className="flex flex-col flex-grow min-w-0" style={{ minHeight: 0 }}>
                    <div
                        className="flex flex-col flex-grow min-w-0"
                        style={{ display: view === "terminal" ? "flex" : "none" }}
                    >
                        <PaneStrip tabId={tabId} />
                        {empty ? <EmptyProject tabId={tabId} /> : children}
                    </div>
                </div>
                {view === "terminal" && <NotesRail tabId={tabId} />}
            </div>
            </>
            )}
            </div>
            <StatusBar inbox={inbox && !isPage(view)} />
            {overlay === "palette" && <Palette names={names} />}
            {overlay === "keymap" && <Keymap />}
            {overlay === "confirm-close" && <ConfirmClose />}
            {overlay === "name-session" && <NameSession />}
            {overlay === "epic" && <EpicPicker />}
            {overlay === "new-step" && <NewStep />}
            {overlay === "move-session" && <MoveSession />}
            <MoveNudge />
            <UndoToast />
            <KeyBadges />
        </div>
    );
});
WintosTabArea.displayName = "WintosTabArea";

// Magnify shows one pane at a time, and that pane is always the focused one: a new terminal,
// a page a link opened, a session another key moved to. Otherwise focus lands in a pane hidden
// behind the magnified one, and keys go somewhere you can't see. ⌘M still turns magnify off.
function useMagnifyFollowsFocus(): void {
    const lm = getLayoutModelForStaticTab();
    const magnified = useAtomValue(lm.magnifiedNodeIdAtom);
    const focused = useAtomValue(lm.focusedNode);
    useEffect(() => {
        if (magnified && focused && focused.id !== magnified) lm.magnifyNodeToggle(focused.id);
    }, [magnified, focused?.id]);
}

// Closing the last pane leaves the project open, until you close it yourself; say what to do next.
function EmptyProject({ tabId }: { tabId: string }) {
    const { state } = useWintos();
    const shelved = state?.shelf?.[tabId]?.length ?? 0;
    const keys: [string, string, () => void][] = [
        ...(shelved ? [["⌥⌘1", shelved > 1 ? `the newest of ${shelved} shelved sessions back (in the notes)` : "the shelved session back (in the notes)", () => runKey("session-1")] as [string, string, () => void]] : []),
        ["⌘T", "new terminal", () => runKey("terminal")],
        ["⌘J ⌘K", "another project", () => runKey("switch-next")],
        ["⌘W", "close this project", () => closeProjectTab(tabId, false)],
    ];
    return (
        <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, fontFamily: T.ui, color: T.muted }}>
            <span style={{ fontFamily: T.display, fontSize: 24, color: T.secondary }}>Nothing open in this project</span>
            <div style={{ display: "grid", gridTemplateColumns: "auto auto", gap: "10px 28px" }}>
                {keys.map(([k, label, act]) => (
                    <button key={k} type="button" data-key={k} tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={act} style={{ justifySelf: "start", padding: 0, background: "transparent", border: "none", cursor: "pointer" }}>
                        <Key k={k} label={label} />
                    </button>
                ))}
            </div>
        </div>
    );
}

function useTabNames(): Record<string, string | undefined> {
    const ws = useAtomValue(atoms.workspace);
    const ids = ws?.tabids ?? [];
    const namesAtom = useMemo(
        () =>
            atom((get) =>
                Object.fromEntries(ids.map((id) => [id, get(getWaveObjectAtom<Tab>(makeORef("tab", id)))?.name]))
            ),
        [ids.join(",")]
    );
    return useAtomValue(namesAtom);
}
