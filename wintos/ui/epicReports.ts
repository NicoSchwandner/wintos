import { useEffect, useState } from "react";
import type { Reports } from "../daemon/epics/reports";
import { relayPrompt, type Relays } from "../daemon/epics/relay";
import { resumeScriptOf, type Session } from "../daemon/sessions/reduce";
import { canTypeInto } from "./outbox";
import { noteResume, resumingNow } from "./resuming";
import { DRAFT_RETRY_MS, DraftInPane, typeIntoPane } from "./typeIntoPane";
import { daemonFetch } from "./useWintos";

// A report waits this long for others, so a busy minute reaches the agent as one prompt.
export const GATHER_MS = 60_000;

// When an epic agent in this tab gets its queued reports typed in: it is not at work, and you
// are not looking at its pane (typing over what you are writing to it would mix the two).
export type ReportDelivery = { agent: string; blockId: string; text: string; n: number };
export function reportDeliveries(reports: Reports, sessions: Session[], tabId: string, now: number, lookingAt?: string): ReportDelivery[] {
    return Object.entries(reports).flatMap(([agent, list]) => {
        const s = sessions.find((x) => x.id === agent);
        if (!canTypeInto(s, tabId, lookingAt) || !list.length || now - list[0].at < GATHER_MS) return [];
        return [{ agent, blockId: s.blockId, n: list.length, text: `[WintOS report] ${list.map((r) => r.text).join(" · ")}` }];
    });
}

// What the epic agent passed on from you, typed into its session the same way, without the wait:
// it is your answer, and the session may be waiting on it.
export function relayDeliveries(relays: Relays, sessions: Session[], epics: { id: string; title: string; short?: string }[], tabId: string, lookingAt?: string): ReportDelivery[] {
    return Object.entries(relays).flatMap(([to, list]) => {
        const s = sessions.find((x) => x.id === to);
        if (!canTypeInto(s, tabId, lookingAt) || !list.length) return [];
        const e = epics.find((x) => x.id === s.epic);
        return [{ agent: to, blockId: s.blockId, n: list.length, text: list.map((r) => relayPrompt(r, e ? (e.short ?? e.title) : "epic")).join("\n") }];
    });
}

// Feedback on a PR for an owner that is paused, or not started since a restart: it is started
// again in its own pane, and the feedback is typed in once it runs. Only a PR hand-off does this;
// what an epic agent passes on waits until you open the session.
export function relayResumes(relays: Relays, sessions: Session[], tabId: string): { sessionId: string; blockId: string; script: string }[] {
    return Object.entries(relays).flatMap(([to, list]) => {
        const s = sessions.find((x) => x.id === to);
        const script = s && list.some((r) => r.about) && s.restored && s.state !== "ended" && s.tabId === tabId && s.blockId ? resumeScriptOf(s) : undefined;
        return s && script ? [{ sessionId: s.id, blockId: s.blockId, script }] : [];
    });
}

const busy = new Set<string>();
export function useEpicReports(reports: Reports | undefined, sessions: Session[] | undefined, tabId: string, now: number, lookingAt: string | undefined, relays: Relays = {}, epics: { id: string; title: string; short?: string }[] = []): void {
    const due = reports && sessions ? reportDeliveries(reports, sessions, tabId, now, lookingAt) : [];
    const relayed = sessions ? relayDeliveries(relays, sessions, epics, tabId, lookingAt) : [];
    const resumes = sessions ? relayResumes(relays, sessions, tabId) : [];
    const key = [...due, ...relayed].map((d) => `${d.agent}:${d.n}`).join(" ") + resumes.map((r) => ` resume:${r.sessionId}`).join("");
    // A pane with your draft in it waits; this asks again a little later.
    const [retry, setRetry] = useState(0);
    const later = (e: unknown) => e instanceof DraftInPane && setTimeout(() => setRetry((n) => n + 1), DRAFT_RETRY_MS);
    useEffect(() => {
        for (const d of due) {
            if (busy.has(d.agent)) continue;
            busy.add(d.agent);
            // Typed first, marked delivered after: a pane that can't take it keeps the queue.
            void typeIntoPane(d.blockId, d.text)
                .then(() => daemonFetch(`/agents/${encodeURIComponent(d.agent)}/reports/delivered`, { method: "POST", body: { n: d.n } }))
                .catch(later)
                .finally(() => busy.delete(d.agent));
        }
        for (const r of resumes) {
            if (resumingNow(r.sessionId)) continue;
            noteResume(r.script);
            void typeIntoPane(r.blockId, r.script).catch(() => {});
        }
        for (const d of relayed) {
            if (busy.has(`relay:${d.agent}`)) continue;
            busy.add(`relay:${d.agent}`);
            void typeIntoPane(d.blockId, d.text)
                .then(() => daemonFetch(`/sessions/${encodeURIComponent(d.agent)}/relays/delivered`, { method: "POST", body: { n: d.n } }))
                .catch(later)
                .finally(() => busy.delete(`relay:${d.agent}`));
        }
    }, [key, retry]);
}
