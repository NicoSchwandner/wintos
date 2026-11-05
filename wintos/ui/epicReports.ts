import { useEffect } from "react";
import type { Reports } from "../daemon/epics/reports";
import { relayPrompt, type Relays } from "../daemon/epics/relay";
import type { Session } from "../daemon/sessions/reduce";
import { typeIntoPane } from "./typeIntoPane";
import { daemonFetch } from "./useWintos";

// A report waits this long for others, so a busy minute reaches the agent as one prompt.
export const GATHER_MS = 60_000;

// When an epic agent in this tab gets its queued reports typed in: it is not at work, and you
// are not looking at its pane (typing over what you are writing to it would mix the two).
export type ReportDelivery = { agent: string; blockId: string; text: string; n: number };
export function reportDeliveries(reports: Reports, sessions: Session[], tabId: string, now: number, lookingAt?: string): ReportDelivery[] {
    return Object.entries(reports).flatMap(([agent, list]) => {
        const s = sessions.find((x) => x.id === agent && x.state !== "ended");
        if (!s || s.tabId !== tabId || s.state === "working" || s.blockId === lookingAt || !list.length || now - list[0].at < GATHER_MS) return [];
        return [{ agent, blockId: s.blockId, n: list.length, text: `[WintOS report] ${list.map((r) => r.text).join(" · ")}` }];
    });
}

// What the epic agent passed on from you, typed into its session the same way, without the wait:
// it is your answer, and the session may be waiting on it.
export function relayDeliveries(relays: Relays, sessions: Session[], epics: { id: string; title: string; short?: string }[], tabId: string, lookingAt?: string): ReportDelivery[] {
    return Object.entries(relays).flatMap(([to, list]) => {
        const s = sessions.find((x) => x.id === to && x.state !== "ended");
        if (!s || s.tabId !== tabId || s.state === "working" || s.blockId === lookingAt || !list.length) return [];
        const e = epics.find((x) => x.id === s.epic);
        return [{ agent: to, blockId: s.blockId, n: list.length, text: list.map((r) => relayPrompt(r, e ? (e.short ?? e.title) : "epic")).join("\n") }];
    });
}

const busy = new Set<string>();
export function useEpicReports(reports: Reports | undefined, sessions: Session[] | undefined, tabId: string, now: number, lookingAt: string | undefined, relays: Relays = {}, epics: { id: string; title: string; short?: string }[] = []): void {
    const due = reports && sessions ? reportDeliveries(reports, sessions, tabId, now, lookingAt) : [];
    const relayed = sessions ? relayDeliveries(relays, sessions, epics, tabId, lookingAt) : [];
    const key = [...due, ...relayed].map((d) => `${d.agent}:${d.n}`).join(" ");
    useEffect(() => {
        for (const d of due) {
            if (busy.has(d.agent)) continue;
            busy.add(d.agent);
            void daemonFetch(`/agents/${encodeURIComponent(d.agent)}/reports/delivered`, { method: "POST", body: { n: d.n } })
                .then((r) => (r.ok ? typeIntoPane(d.blockId, d.text) : undefined))
                .catch(() => {})
                .finally(() => busy.delete(d.agent));
        }
        for (const d of relayed) {
            if (busy.has(`relay:${d.agent}`)) continue;
            busy.add(`relay:${d.agent}`);
            void daemonFetch(`/sessions/${encodeURIComponent(d.agent)}/relays/delivered`, { method: "POST", body: { n: d.n } })
                .then((r) => (r.ok ? typeIntoPane(d.blockId, d.text) : undefined))
                .catch(() => {})
                .finally(() => busy.delete(`relay:${d.agent}`));
        }
    }, [key]);
}
