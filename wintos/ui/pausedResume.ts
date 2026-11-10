import { useEffect } from "react";
import { resumeScriptOf, type Session } from "../daemon/sessions/reduce";
import { noteResume, resumingNow } from "./resuming";
import { typeIntoPane } from "./typeIntoPane";

// The paused session (daemon/sessions/pause.ts) in the pane you are at, and the line that starts it again.
export function pausedHere(sessions: Session[], tabId: string, blockId: string | undefined): { id: string; script: string } | undefined {
    const s = blockId ? sessions.find((x) => x.blockId === blockId && x.tabId === tabId && x.paused && x.state !== "ended") : undefined;
    const script = s && resumeScriptOf(s);
    return s && script ? { id: s.id, script } : undefined;
}

// Opening a paused session's pane starts it again there: you came to it, so it runs. Only in the
// window you are in, on the terminals: a cached tab behind it has a focused pane of its own.
export function usePausedResume(sessions: Session[] | undefined, tabId: string, blockId: string | undefined, here: boolean): void {
    const p = here && sessions ? pausedHere(sessions, tabId, blockId) : undefined;
    useEffect(() => {
        if (!p || !blockId || resumingNow(p.id)) return;
        noteResume(p.script);
        void typeIntoPane(blockId, p.script).catch(() => {});
    }, [p?.id, blockId]);
}
