import { useEffect, useState } from "react";
import type { WintosState } from "./view";

const BASE = "http://127.0.0.1:7730";
const OFFLINE_AFTER_MS = 3000;

// One live view of wintosd. EventSource reconnects on its own; we only decide when a gap is
// long enough to stop showing bands that may be stale.
export function useWintos(): { state: WintosState | null; offline: boolean } {
    const [state, setState] = useState<WintosState | null>(null);
    const [offline, setOffline] = useState(false);
    useEffect(() => {
        const es = new EventSource(`${BASE}/stream`);
        let timer: ReturnType<typeof setTimeout> | undefined;
        es.addEventListener("state", (e) => {
            clearTimeout(timer);
            setOffline(false);
            setState(JSON.parse((e as MessageEvent).data));
        });
        es.onerror = () => {
            clearTimeout(timer);
            timer = setTimeout(() => setOffline(true), OFFLINE_AFTER_MS);
        };
        return () => (clearTimeout(timer), es.close());
    }, []);
    return { state, offline };
}

export function setProjectTitle(tabId: string, title: string, manual: boolean): Promise<Response> {
    return fetch(`${BASE}/projects/${encodeURIComponent(tabId)}/title`, {
        method: "POST",
        body: JSON.stringify({ title, manual }),
    });
}
