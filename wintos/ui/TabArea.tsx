import { getWaveObjectAtom, makeORef } from "@/app/store/wos";
import { atoms } from "@/store/global";
import { atom, useAtomValue } from "jotai";
import { memo, useMemo } from "react";
import { ConfirmClose } from "./ConfirmClose";
import "./theme.css";
import { Key } from "./Key";
import { Keymap } from "./Keymap";
import { useSeenReporter } from "./useSeenReporter";
import { useNewProjectPaste } from "./newproject";
import { useWintos } from "./useWintos";
import { NotesFull } from "./notes/NotesFull";
import { NotesRail } from "./notes/NotesRail";
import { mainViewAtom, overlayAtom } from "./notes/state";
import { Palette } from "./Palette";
import { InboxArea } from "./InboxArea";
import { inboxKind, isInboxTab } from "./view";
import { PaneStrip } from "./PaneStrip";
import { StatusBar } from "./StatusBar";
import { T } from "./tokens";

// The project area: session strip over the terminals, the notes rail beside them, and ⇧⌘L
// swapping the terminals for both notes files. Terminals stay mounted underneath.
export const WintosTabArea = memo(({ tabId, children }: { tabId: string; children: React.ReactNode }) => {
    const view = useAtomValue(mainViewAtom);
    const overlay = useAtomValue(overlayAtom);
    const names = useTabNames();
    useSeenReporter(tabId);
    const tab = useAtomValue(useMemo(() => getWaveObjectAtom<Tab>(makeORef("tab", tabId)), [tabId]));
    // The last pane closing leaves blockids null, not [].
    const empty = !!tab && !tab.blockids?.length;
    const { state } = useWintos();
    const inbox = isInboxTab(tab);
    useNewProjectPaste(tabId, inbox ? undefined : tab?.blockids, state ?? undefined);
    return (
        <div className="flex flex-col flex-grow min-w-0" style={{ position: "relative" }}>
            {inbox ? (
                <InboxArea tabId={tabId} list={inboxKind(tab)!} empty={empty}>
                    {children}
                </InboxArea>
            ) : (
            <>
            <div className="flex flex-row flex-grow min-w-0" style={{ minHeight: 0 }}>
                <div className="flex flex-col flex-grow min-w-0" style={{ minHeight: 0 }}>
                    {view === "notes" && <NotesFull tabId={tabId} />}
                    <div
                        className="flex flex-col flex-grow min-w-0"
                        style={{ display: view === "terminal" ? "flex" : "none" }}
                    >
                        <PaneStrip tabId={tabId} />
                        {empty ? <EmptyProject /> : children}
                    </div>
                </div>
                {view === "terminal" && <NotesRail tabId={tabId} />}
            </div>
            <StatusBar />
            </>
            )}
            {overlay === "palette" && <Palette names={names} />}
            {overlay === "keymap" && <Keymap />}
            {overlay === "confirm-close" && <ConfirmClose />}
        </div>
    );
});
WintosTabArea.displayName = "WintosTabArea";

// Closing the last pane leaves the project open; say what to do next.
function EmptyProject() {
    const keys: [string, string][] = [["⇧⌘T", "new Claude session"], ["⌘T", "new terminal"], ["⌘J ⌘K", "another project"], ["⇧⌘W", "close this project"]];
    return (
        <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, fontFamily: T.ui, color: T.muted }}>
            <span style={{ fontFamily: T.display, fontSize: 24, color: T.secondary }}>Nothing open in this project</span>
            <div style={{ display: "grid", gridTemplateColumns: "auto auto", gap: "10px 28px" }}>
                {keys.map(([k, label]) => <Key key={k} k={k} label={label} />)}
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
