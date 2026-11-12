import { globalStore } from "@/app/store/jotaiStore";
import { getLayoutModelForStaticTab } from "@/layout/index";
import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";
import { mainViewAtom } from "./notes/state";
import { unreadSessions } from "./sessions";
import { currentState, daemonFetch } from "./useWintos";

const SEEN_AFTER_MS = 2000;

// A reply is read once its pane has had the focus, window focused and terminals showing, for two
// seconds, or at once if you were already there when it came in (otherwise the open project would
// jump to Needs you after every reply). Only the focused pane's session is acked.
export function useSeenReporter(tabId: string): void {
    const view = useAtomValue(mainViewAtom);
    const looking = useRef({ blockId: "", since: 0 });
    const reported = useRef<Record<string, number>>({});
    useEffect(() => {
        const tick = () => {
            const lm = getLayoutModelForStaticTab();
            const blockId = (lm && globalStore.get(lm.focusedNode)?.data?.blockId) ?? "";
            const now = document.visibilityState === "visible" && document.hasFocus() && view === "terminal";
            if (!now || !blockId) return void (looking.current = { blockId: "", since: 0 });
            if (looking.current.blockId !== blockId) looking.current = { blockId, since: Date.now() };
            const state = currentState();
            const s = state && unreadSessions(state.sessions, tabId, state.seen).find((x) => x.blockId === blockId);
            if (!s || (reported.current[s.id] ?? 0) >= s.turnEndedAt!) return;
            if (looking.current.since > s.turnEndedAt! && Date.now() - looking.current.since < SEEN_AFTER_MS) return;
            reported.current[s.id] = s.turnEndedAt!;
            void daemonFetch(`/sessions/${encodeURIComponent(s.id)}/seen`, { method: "POST", body: {} }).catch(() => delete reported.current[s.id]);
        };
        tick();
        const t = setInterval(tick, 250);
        return () => clearInterval(t);
    }, [view, tabId]);
}
