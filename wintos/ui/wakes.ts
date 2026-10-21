import { useEffect } from "react";
import { wakePrompt, type Wakes } from "../daemon/wakes/wakes";
import type { Session } from "../daemon/sessions/reduce";
import { typeIntoPane } from "./typeIntoPane";
import { daemonFetch } from "./useWintos";

// The due wakes this window types now: its own tab's live sessions, between turns (a prompt typed
// mid-turn would be queued behind work the session is still doing).
export function deliverable(wakes: Wakes, sessions: Session[], tabId: string): { sessionId: string; blockId: string; text: string }[] {
    return Object.values(wakes).flatMap((w) => {
        const s = sessions.find((x) => x.id === w.sessionId && x.tabId === tabId && x.blockId && x.state !== "ended" && x.state !== "working");
        return w.due && s ? [{ sessionId: s.id, blockId: s.blockId, text: wakePrompt(w) }] : [];
    });
}

// Whichever window claims a wake first types it; the daemon says yes to one only.
const typing = new Set<string>();
export function useWakeDelivery(wakes: Wakes | undefined, sessions: Session[] | undefined, tabId: string): void {
    const due = wakes && sessions ? deliverable(wakes, sessions, tabId) : [];
    const key = due.map((d) => d.sessionId).join(" ");
    useEffect(() => {
        for (const d of due) {
            if (typing.has(d.sessionId)) continue;
            typing.add(d.sessionId);
            void daemonFetch(`/wakes/${encodeURIComponent(d.sessionId)}/delivered`, { method: "POST", body: {} })
                .then((r) => (r.ok ? typeIntoPane(d.blockId, d.text) : undefined))
                .catch(() => {})
                .finally(() => typing.delete(d.sessionId));
        }
    }, [key]);
}
