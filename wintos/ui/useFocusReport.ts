import { useEffect } from "react";
import { focusedSession } from "./focus";
import { daemonFetch } from "./useWintos";

const EVERY_MS = 5_000;

// Tells wintosd which session you are at, for the time each epic gets (daemon/epics/time.ts).
// Every tab has its own renderer, so only the one on screen speaks; it says "none" when WintOS
// loses focus, since then you are somewhere else.
export function useFocusReport(): void {
    useEffect(() => {
        const report = (sessionId: string | null) => void daemonFetch("/focus", { method: "POST", body: { sessionId } }).catch(() => {});
        const tick = () => {
            if (document.visibilityState === "visible" && document.hasFocus()) report(focusedSession()?.id ?? null);
        };
        const blur = () => document.visibilityState === "visible" && report(null);
        const timer = setInterval(tick, EVERY_MS);
        window.addEventListener("focus", tick);
        window.addEventListener("blur", blur);
        return () => {
            clearInterval(timer);
            window.removeEventListener("focus", tick);
            window.removeEventListener("blur", blur);
        };
    }, []);
}
