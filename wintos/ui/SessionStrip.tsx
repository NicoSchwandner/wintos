import { globalStore } from "@/app/store/jotaiStore";
import { getLayoutModelForStaticTab } from "@/layout/index";
import { useAtomValue } from "jotai";
import { memo, useEffect } from "react";
import { getWaveObjectAtom, makeORef } from "@/app/store/wos";
import { focusSession, takeHandoff } from "./focus";
import { liveSessions, stripSessions, unreadSessions } from "./sessions";
import { T } from "./tokens";
import { useNow } from "./useNow";
import { useWintos } from "./useWintos";
import { relTime } from "./view";

const DOT = { working: T.moss, waiting: T.apricot, parked: T.muted, done: T.dim, idle: T.dim, ended: T.dim } as const;

export const SessionStrip = memo(({ tabId }: { tabId: string }) => {
    const { state } = useWintos();
    const tab = useAtomValue(getWaveObjectAtom<Tab>(makeORef("tab", tabId)));
    const now = useNow();
    const lm = getLayoutModelForStaticTab();
    const magnified = useAtomValue(lm.magnifiedNodeIdAtom);

    useEffect(() => {
        takeHandoff();
        const onStorage = () => takeHandoff();
        window.addEventListener("storage", onStorage);
        document.addEventListener("visibilitychange", onStorage);
        return () => (window.removeEventListener("storage", onStorage), document.removeEventListener("visibilitychange", onStorage));
    }, []);

    const sessions = state ? stripSessions(liveSessions(state.sessions, { [tabId]: tab?.blockids }), tabId) : [];
    if (!sessions.length) return null;
    const unread = new Set(unreadSessions(sessions, tabId, state?.seen?.[tabId]).map((s) => s.id));
    return (
        <div style={{ display: "flex", gap: 4, padding: "6px 8px 0", fontFamily: T.mono, fontSize: 11, flexShrink: 0, overflowX: "auto" }}>
            {sessions.map((s, i) => {
                const isOn = magnified != null && globalStore.get(lm.magnifiedNodeIdAtom) === lm.getNodeByBlockId(s.blockId)?.id;
                return (
                    <button
                        key={s.id}
                        data-session={s.id}
                        type="button"
                        onClick={() => focusSession({ tabId, blockId: s.blockId })}
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 7,
                            padding: "5px 10px",
                            borderRadius: 8,
                            border: `1px solid ${isOn ? T.borderActive : T.border}`,
                            background: isOn ? T.cardActive : "transparent",
                            color: isOn ? T.emphasis : T.secondary,
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                            fontFamily: T.mono,
                            fontSize: 11,
                        }}
                    >
                        {/* Unread: a ring in the waiting colour until you have looked. */}
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: DOT[s.state], boxShadow: unread.has(s.id) && s.state !== "waiting" ? `0 0 0 2px ${T.apricot}` : undefined }} />
                        {s.label ?? `session ${i + 1}`}
                        {s.state === "waiting" && <span style={{ color: T.apricot }}>{relTime(now - s.since)}</span>}
                    </button>
                );
            })}
        </div>
    );
});
SessionStrip.displayName = "SessionStrip";
