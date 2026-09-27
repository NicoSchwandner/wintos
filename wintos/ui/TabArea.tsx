import { getWaveObjectAtom, makeORef } from "@/app/store/wos";
import { atoms } from "@/store/global";
import { atom, useAtomValue } from "jotai";
import { memo, useMemo } from "react";
import { Keymap } from "./Keymap";
import { NotesFull } from "./notes/NotesFull";
import { NotesRail } from "./notes/NotesRail";
import { mainViewAtom, overlayAtom } from "./notes/state";
import { Palette } from "./Palette";
import { PanelView } from "./PanelView";
import { PrQueue } from "./PrQueue";
import { SessionStrip } from "./SessionStrip";
import { StatusBar } from "./StatusBar";

// The project area: session strip over the terminals, the notes rail beside them, and ⌘J
// swapping the terminals for both notes files. Terminals stay mounted underneath.
export const WintosTabArea = memo(({ tabId, children }: { tabId: string; children: React.ReactNode }) => {
    const view = useAtomValue(mainViewAtom);
    const overlay = useAtomValue(overlayAtom);
    const names = useTabNames();
    return (
        <div className="flex flex-col flex-grow min-w-0" style={{ position: "relative" }}>
            <div className="flex flex-row flex-grow min-w-0" style={{ minHeight: 0 }}>
                <div className="flex flex-col flex-grow min-w-0">
                    {view === "notes" && <NotesFull tabId={tabId} />}
                    {view === "prs" && <PrQueue />}
                    {view === "panel" && <PanelView />}
                    <div
                        className="flex flex-col flex-grow min-w-0"
                        style={{ display: view === "terminal" ? "flex" : "none" }}
                    >
                        <SessionStrip tabId={tabId} />
                        {children}
                    </div>
                </div>
                {view === "terminal" && <NotesRail tabId={tabId} />}
            </div>
            <StatusBar />
            {overlay === "palette" && <Palette names={names} />}
            {overlay === "keymap" && <Keymap />}
        </div>
    );
});
WintosTabArea.displayName = "WintosTabArea";

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
