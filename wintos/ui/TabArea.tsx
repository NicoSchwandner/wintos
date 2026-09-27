import { useAtomValue } from "jotai";
import { memo } from "react";
import { NotesFull } from "./notes/NotesFull";
import { NotesRail } from "./notes/NotesRail";
import { mainViewAtom } from "./notes/state";
import { PrQueue } from "./PrQueue";
import { SessionStrip } from "./SessionStrip";

// The project area: session strip over the terminals, the notes rail beside them, and ⌘J
// swapping the terminals for both notes files. Terminals stay mounted underneath.
export const WintosTabArea = memo(({ tabId, children }: { tabId: string; children: React.ReactNode }) => {
    const view = useAtomValue(mainViewAtom);
    return (
        <div className="flex flex-row flex-grow min-w-0">
            <div className="flex flex-col flex-grow min-w-0">
                {view === "notes" && <NotesFull tabId={tabId} />}
                {view === "prs" && <PrQueue />}
                <div className="flex flex-col flex-grow min-w-0" style={{ display: view === "terminal" ? "flex" : "none" }}>
                    <SessionStrip tabId={tabId} />
                    {children}
                </div>
            </div>
            {view === "terminal" && <NotesRail tabId={tabId} />}
        </div>
    );
});
WintosTabArea.displayName = "WintosTabArea";
