import { useEffect, useRef, useState } from "react";

// The notes rail's width, dragged from its left edge. Kept in localStorage, which every
// project's renderer shares: it is one width for all of them, and it survives a restart.
const KEY = "wintos:rail-width";
export const RAIL_DEFAULT = 352;
export const clampRail = (px: number, windowWidth: number) => Math.round(Math.min(Math.max(px, 260), Math.max(260, windowWidth * 0.6)));

function stored(): number {
    try {
        const v = Number(localStorage.getItem(KEY));
        return v > 0 ? v : RAIL_DEFAULT;
    } catch {
        return RAIL_DEFAULT;
    }
}

export function useRailWidth(): [number, (px: number) => void, () => void] {
    const [width, setWidth] = useState(stored);
    const latest = useRef(width); // a drag saves on release, long after the render it began in
    useEffect(() => {
        // Another project dragged it: follow when this one is shown again.
        const sync = () => setWidth((latest.current = stored()));
        window.addEventListener("storage", sync);
        return () => window.removeEventListener("storage", sync);
    }, []);
    const save = () => {
        try {
            localStorage.setItem(KEY, String(latest.current));
        } catch {}
    };
    const set = (px: number) => setWidth((latest.current = clampRail(px, window.innerWidth)));
    return [width, set, save];
}
