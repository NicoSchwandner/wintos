import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { stringToBase64 } from "@/util/util";
import { useEffect, useRef } from "react";
import { focusArea } from "./focus";

// "Open as new project" from the PR queue: the new project's Claude prompt starts with the PR's
// link, pasted, not sent, so the developer writes the rest. The queue and the new project are separate renderers, so the prompt is handed over
// in localStorage, which they share.
const KEY = "wintos:new-project";
const TTL_MS = 30_000;

type Storage = { getItem(k: string): string | null; removeItem(k: string): void };

export function prLinkPaste(url: string): string {
    return `\x1b[200~${url}\n\x1b[201~`;
}

export function offerPrompt(prompt: string): void {
    localStorage.setItem(KEY, JSON.stringify({ prompt, at: Date.now() }));
}

export function takePendingPrompt(ls: Storage, now: number): string | undefined {
    const raw = ls.getItem(KEY);
    if (!raw) return undefined;
    ls.removeItem(KEY);
    const { prompt, at } = JSON.parse(raw) as { prompt: string; at: number };
    return now - at < TTL_MS ? prompt : undefined;
}

// In the new project: once its Claude reports in (its first hook event means the prompt is up),
// paste the handed-over text into it. Only a brand-new project claims it: one pane and no project
// folder yet (Claude creates that on the first prompt; its first hook may beat this UI's load).
export function useNewProjectPaste(tabId: string, blockIds: string[] | undefined, state: { sessions: { blockId: string }[]; projects: { id?: string }[] } | undefined): void {
    const sessions = state?.sessions;
    const pending = useRef<string | undefined>(undefined);
    const claimed = useRef(false);
    useEffect(() => {
        if (claimed.current || !blockIds || blockIds.length !== 1 || !state || state.projects.some((p) => p.id === tabId)) return;
        claimed.current = true;
        pending.current = takePendingPrompt(localStorage, Date.now());
    }, [tabId, blockIds?.length, !!state]);
    const ready = !!blockIds?.[0] && !!sessions?.some((s) => s.blockId === blockIds[0]);
    useEffect(() => {
        if (!ready || !pending.current) return;
        const text = pending.current;
        pending.current = undefined;
        void RpcApi.ControllerInputCommand(TabRpcClient, { blockid: blockIds![0], inputdata64: stringToBase64(text) });
        focusArea("terminal");
    }, [ready]);
}
