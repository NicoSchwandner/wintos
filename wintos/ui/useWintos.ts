import { useEffect, useState } from "react";
import { getApi } from "@/store/global";
import type { WintosState } from "./view";

// This window's daemon: the everyday one, or a second (dev) instance's own.
export const instance = (() => {
    let cached: { port: number; label: string } | undefined;
    return () => (cached ??= getApi().getWintosInstance());
})();
const base = () => `127.0.0.1:${instance().port}`;
const OFFLINE_AFTER_MS = 3000;
const RETRY_MS = 1000;

// One socket per renderer, shared by every component. Each Wave tab is its own renderer, so
// this is still one connection per cached tab; a WebSocket keeps that out of Chromium's
// six-per-host HTTP connection pool.
type Snapshot = { state: WintosState | null; offline: boolean };
let snapshot: Snapshot = { state: null, offline: false };
const listeners = new Set<(s: Snapshot) => void>();
let started = false;
let offlineTimer: ReturnType<typeof setTimeout> | undefined;

function publish(next: Partial<Snapshot>) {
    snapshot = { ...snapshot, ...next };
    for (const l of listeners) l(snapshot);
}

const token = () => getApi().getWintosToken();

// Every UI request to wintosd goes through here, so none forgets the launch token.
export function daemonFetch(path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
    return fetch(`http://${base()}${path}`, {
        method: init.method ?? "GET",
        headers: { "X-Wintos-Token": token(), ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}) },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
}

function connect() {
    const ws = new WebSocket(`ws://${base()}/ws?token=${token()}`);
    ws.onmessage = (m) => {
        clearTimeout(offlineTimer);
        offlineTimer = undefined;
        publish({ state: JSON.parse(m.data), offline: false });
    };
    ws.onclose = () => {
        offlineTimer ??= setTimeout(() => publish({ offline: true }), OFFLINE_AFTER_MS);
        setTimeout(connect, RETRY_MS);
    };
}

export const currentState = () => snapshot.state;

export function useWintos(): Snapshot {
    const [s, setS] = useState(snapshot);
    useEffect(() => {
        if (!started) (started = true), connect();
        listeners.add(setS);
        setS(snapshot);
        return () => void listeners.delete(setS);
    }, []);
    return s;
}

// ⌥⌘Z, opening a project, or it needing you: in or out of the sidebar's Snoozed group.
export function setProjectSnoozed(tabId: string, on: boolean): Promise<Response> {
    return daemonFetch(`/projects/${encodeURIComponent(tabId)}/snooze`, { method: "POST", body: { on } });
}

export function setProjectTitle(tabId: string, title: string, manual: boolean): Promise<Response> {
    return daemonFetch(`/projects/${encodeURIComponent(tabId)}/title`, { method: "POST", body: { title, manual } });
}
