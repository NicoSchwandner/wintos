import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";
import { mainViewAtom } from "./notes/state";
import { unreadSessions } from "./sessions";
import { daemonFetch, useWintos } from "./useWintos";

const SEEN_AFTER_MS = 2000;

// A reply is read once its project has been on screen, window focused, terminals or notes
// showing, for two seconds, or at once if you were already looking when it came in (otherwise
// the open project would jump to Needs you after every reply). Only unread replies are reported.
export function useSeenReporter(tabId: string): void {
    const { state } = useWintos();
    const view = useAtomValue(mainViewAtom);
    const latestUnread = state ? Math.max(0, ...unreadSessions(state.sessions, tabId, state.seen?.[tabId]).map((s) => s.turnEndedAt ?? 0)) : 0;
    const lookingSince = useRef(0);
    const reported = useRef(0);
    useEffect(() => {
        const tick = () => {
            const looking = document.visibilityState === "visible" && document.hasFocus() && (view === "terminal" || view === "notes");
            if (!looking) return void (lookingSince.current = 0);
            lookingSince.current ||= Date.now();
            if (!latestUnread || reported.current >= latestUnread) return;
            if (lookingSince.current > latestUnread && Date.now() - lookingSince.current < SEEN_AFTER_MS) return;
            reported.current = latestUnread;
            void daemonFetch(`/projects/${encodeURIComponent(tabId)}/seen`, { method: "POST", body: {} }).catch(() => (reported.current = 0));
        };
        tick();
        const t = setInterval(tick, 250);
        return () => clearInterval(t);
    }, [latestUnread, view, tabId]);
}
