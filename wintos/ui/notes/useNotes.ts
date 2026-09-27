import { useEffect, useState } from "react";
import { useWintos } from "../useWintos";

const BASE = "http://127.0.0.1:7730";
export type NotesData = { dir: string; projectMd: string | null; mine: string };

// Re-fetches whenever the project's files change on disk (the daemon's state carries mtime).
export function useNotes(tabId: string): { notes: NotesData | null; project: { title?: string; next?: string } | undefined; save: (text: string) => Promise<boolean> } {
    const { state } = useWintos();
    const project = state?.projects.find((p) => p.id === tabId);
    const [notes, setNotes] = useState<NotesData | null>(null);
    useEffect(() => {
        if (!project) return setNotes(null);
        let live = true;
        fetch(`${BASE}/projects/${encodeURIComponent(tabId)}/notes`)
            .then((r) => (r.ok ? r.json() : null))
            .then((n) => live && setNotes(n))
            .catch(() => live && setNotes(null));
        return () => void (live = false);
    }, [tabId, project?.mtime, project?.dir]);
    const save = async (text: string) => {
        const r = await fetch(`${BASE}/projects/${encodeURIComponent(tabId)}/mine`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
        });
        if (r.ok) setNotes((n) => (n ? { ...n, mine: text } : n));
        return r.ok;
    };
    return { notes, project, save };
}
