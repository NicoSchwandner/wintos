import { useEffect, useState } from "react";
import type { WintosState } from "./view";

const BASE = "127.0.0.1:7730";
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

function connect() {
    const ws = new WebSocket(`ws://${BASE}/ws`);
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

export function setProjectTitle(tabId: string, title: string, manual: boolean): Promise<Response> {
    return fetch(`http://${BASE}/projects/${encodeURIComponent(tabId)}/title`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, manual }),
    });
}
