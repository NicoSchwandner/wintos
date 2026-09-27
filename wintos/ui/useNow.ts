import { useEffect, useState } from "react";

// Ages ("3m", "4d") must move without waiting for the next daemon event.
export function useNow(everyMs = 10_000): number {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), everyMs);
        return () => clearInterval(t);
    }, [everyMs]);
    return now;
}
