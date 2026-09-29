import { getWaveObjectAtom, makeORef } from "@/app/store/wos";
import { atoms } from "@/store/global";
import { atom, useAtomValue } from "jotai";
import { memo, useMemo } from "react";
import { ConfirmClose } from "./ConfirmClose";
import { Key } from "./Key";
import { Keymap } from "./Keymap";
import { isPlaceholderTab } from "./view";
import { useSeenReporter } from "./useSeenReporter";
import { NotesFull } from "./notes/NotesFull";
import { NotesRail } from "./notes/NotesRail";
import { mainViewAtom, overlayAtom } from "./notes/state";
import { Palette } from "./Palette";
import { PanelView } from "./PanelView";
import { PrQueue } from "./PrQueue";
import { SessionStrip } from "./SessionStrip";
import { StatusBar } from "./StatusBar";
import { T } from "./tokens";

// The project area: session strip over the terminals, the notes rail beside them, and ⇧⌘J
// swapping the terminals for both notes files. Terminals stay mounted underneath.
export const WintosTabArea = memo(({ tabId, children }: { tabId: string; children: React.ReactNode }) => {
    const view = useAtomValue(mainViewAtom);
    const overlay = useAtomValue(overlayAtom);
    const names = useTabNames();
    useSeenReporter(tabId);
    const tab = useAtomValue(useMemo(() => getWaveObjectAtom<Tab>(makeORef("tab", tabId)), [tabId]));
    const empty = tab?.blockids?.length === 0;
    return (
        <div className="flex flex-col flex-grow min-w-0" style={{ position: "relative" }}>
            <div className="flex flex-row flex-grow min-w-0" style={{ minHeight: 0 }}>
                <div className="flex flex-col flex-grow min-w-0" style={{ minHeight: 0 }}>
                    {view === "notes" && <NotesFull tabId={tabId} />}
                    {view === "prs" && <PrQueue />}
                    {view === "panel" && <PanelView />}
                    <div
                        className="flex flex-col flex-grow min-w-0"
                        style={{ display: view === "terminal" ? "flex" : "none" }}
                    >
                        <SessionStrip tabId={tabId} />
                        {empty ? <EmptyProject noProject={isPlaceholderTab(tab)} /> : children}
                    </div>
                </div>
                {view === "terminal" && <NotesRail tabId={tabId} />}
            </div>
            <StatusBar />
            {overlay === "palette" && <Palette names={names} />}
            {overlay === "keymap" && <Keymap />}
            {overlay === "confirm-close" && <ConfirmClose />}
        </div>
    );
});
WintosTabArea.displayName = "WintosTabArea";

// Closing the last pane leaves the project open, and closing the last project leaves the
// placeholder tab; either way, say what to do next.
function EmptyProject({ noProject }: { noProject: boolean }) {
    const keys: [string, string][] = noProject
        ? [["⌘N", "new project"], ["⌘Q", "quit WintOS"]]
        : [["⇧⌘T", "new Claude session"], ["⌘T", "new terminal"], ["⌘J ⌘K", "another project"], ["⌘W", "close this project"]];
    return (
        <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, fontFamily: T.ui, color: T.muted }}>
            <span style={{ fontFamily: T.display, fontSize: 24, color: T.secondary }}>{noProject ? "No project open" : "Nothing open in this project"}</span>
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
