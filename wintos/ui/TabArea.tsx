import { useAtomValue } from "jotai";
import { memo } from "react";
import { NotesFull } from "./notes/NotesFull";
import { NotesRail } from "./notes/NotesRail";
import { notesOpenAtom } from "./notes/state";
import { SessionStrip } from "./SessionStrip";

// The project area: session strip over the terminals, the notes rail beside them, and ⌘J
// swapping the terminals for both notes files. Terminals stay mounted underneath.
export const WintosTabArea = memo(({ tabId, children }: { tabId: string; children: React.ReactNode }) => {
    const notesOpen = useAtomValue(notesOpenAtom);
    return (
        <div className="flex flex-row flex-grow min-w-0">
            <div className="flex flex-col flex-grow min-w-0">
                {notesOpen && <NotesFull tabId={tabId} />}
                <div className="flex flex-col flex-grow min-w-0" style={{ display: notesOpen ? "none" : "flex" }}>
                    <SessionStrip tabId={tabId} />
                    {children}
                </div>
            </div>
            {!notesOpen && <NotesRail tabId={tabId} />}
        </div>
    );
});
WintosTabArea.displayName = "WintosTabArea";
