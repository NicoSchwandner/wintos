import { useEffect, useState } from "react";
import { daemonFetch, useWintos } from "../useWintos";

export type NotesData = { dir: string; projectMd: string | null; mine: string; mineMtime: number };
export type SaveResult = "ok" | "conflict" | "error";

// Re-fetches whenever the project's files change on disk (the daemon's state carries mtime).
export function useNotes(tabId: string): { notes: NotesData | null; project: { title?: string; next?: string } | undefined; save: (text: string, baseMtime: number) => Promise<SaveResult> } {
    const { state } = useWintos();
    const project = state?.projects.find((p) => p.id === tabId);
    const [notes, setNotes] = useState<NotesData | null>(null);
    useEffect(() => {
        if (!project) return setNotes(null);
        let live = true;
        daemonFetch(`/projects/${encodeURIComponent(tabId)}/notes`)
            .then((r) => (r.ok ? r.json() : null))
            .then((n) => live && setNotes(n))
            .catch(() => live && setNotes(null));
        return () => void (live = false);
    }, [tabId, project?.mtime, project?.mineMtime, project?.dir]);
    const save = async (text: string, baseMtime: number): Promise<SaveResult> => {
        try {
            const r = await daemonFetch(`/projects/${encodeURIComponent(tabId)}/mine`, { method: "POST", body: { text, baseMtime } });
            if (r.status === 409) return "conflict";
            if (!r.ok) return "error";
            setNotes((n) => (n ? { ...n, mine: text } : n));
            return "ok";
        } catch {
            return "error";
        }
    };
    return { notes, project, save };
}

// An epic's mine.md, re-read whenever the daemon says the file changed (EpicView.mineMtime).
export function useEpicMine(epicId: string | undefined): { mine: { text: string; mtime: number } | null; save: (text: string, baseMtime: number) => Promise<SaveResult> } {
    const { state } = useWintos();
    const mtime = epicId ? state?.epics?.find((e) => e.id === epicId)?.mineMtime : undefined;
    const [mine, setMine] = useState<{ text: string; mtime: number } | null>(null);
    useEffect(() => {
        if (!epicId) return setMine(null);
        let live = true;
        daemonFetch(`/epics/${encodeURIComponent(epicId)}/mine`)
            .then((r) => (r.ok ? r.json() : null))
            .then((m) => live && setMine(m))
            .catch(() => live && setMine(null));
        return () => void (live = false);
    }, [epicId, mtime]);
    const save = async (text: string, baseMtime: number): Promise<SaveResult> => {
        if (!epicId) return "error";
        try {
            const r = await daemonFetch(`/epics/${encodeURIComponent(epicId)}/mine`, { method: "POST", body: { text, baseMtime } });
            if (r.status === 409) return "conflict";
            return r.ok ? "ok" : "error";
        } catch {
            return "error";
        }
    };
    return { mine, save };
}
