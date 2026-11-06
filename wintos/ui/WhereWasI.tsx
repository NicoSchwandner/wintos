import { globalStore } from "@/app/store/jotaiStore";
import { atoms } from "@/store/global";
import { useAtomValue } from "jotai";
import { memo, useEffect, useRef, useState } from "react";
import type { Reentry } from "../daemon/sessions/reentry";
import { mainViewAtom } from "./notes/state";
import { T } from "./tokens";
import { daemonFetch } from "./useWintos";

export const AWAY_FROM_SESSION_MS = 15 * 60_000;
const SHOWN_MS = 30_000;

// Whether looking at a pane again is a return: you last looked at it this long ago.
export const isReturn = (lastLook: number | undefined, now: number) => lastLook !== undefined && now - lastLook >= AWAY_FROM_SESSION_MS;

// Back in a session you left a while ago: three lines under its header, so you pick up the
// thread before reading the scrollback. Once per return; any key or 30 seconds closes it.
export const WhereWasI = memo(({ sessionId, focused }: { sessionId: string; focused: boolean }) => {
    const view = useAtomValue(mainViewAtom);
    const active = useAtomValue(atoms.workspace)?.activetabid === globalStore.get(atoms.staticTabId);
    const looking = focused && active && view === "terminal";
    const lastLook = useRef<number | undefined>(undefined);
    const [card, setCard] = useState<Reentry | null>(null);
    useEffect(() => {
        if (!looking) return;
        const now = Date.now();
        if (isReturn(lastLook.current, now))
            void daemonFetch(`/sessions/${encodeURIComponent(sessionId)}/reentry`)
                .then((r) => (r.ok ? r.json() : null))
                .then((r: Reentry | null) => r && Object.keys(r).length && setCard(r), () => {});
        lastLook.current = now;
        const timer = setInterval(() => (lastLook.current = Date.now()), 10_000);
        return () => (clearInterval(timer), void (lastLook.current = Date.now()));
    }, [looking, sessionId]);
    useEffect(() => {
        if (!card) return;
        const close = () => setCard(null);
        const timer = setTimeout(close, SHOWN_MS);
        window.addEventListener("keydown", close, true);
        return () => (clearTimeout(timer), window.removeEventListener("keydown", close, true));
    }, [card]);
    if (!card) return null;
    const line = (label: string, text: string | undefined, tone?: string) =>
        text && (
            <span style={{ display: "flex", gap: 10, minWidth: 0 }}>
                <span style={{ width: 62, flexShrink: 0, fontFamily: T.mono, fontSize: 11.5, color: T.faint, paddingTop: 1 }}>{label}</span>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: tone ?? T.secondary }}>{text}</span>
            </span>
        );
    return (
        <div data-wintos="where-was-i" onClick={() => setCard(null)} style={{ display: "flex", flexDirection: "column", gap: 4, padding: "8px 10px", background: T.card, border: `1px solid ${T.borderActive}`, borderRadius: 8, fontSize: 12.5, cursor: "pointer" }}>
            {line("you asked", card.asked)}
            {line("it did", card.did)}
            {line("it needs", card.needs, card.needs?.startsWith("nothing") ? T.muted : T.apricot)}
        </div>
    );
});
WhereWasI.displayName = "WhereWasI";
