import { globalStore } from "@/app/store/jotaiStore";
import { atoms, getApi } from "@/store/global";
import { getLayoutModelForStaticTab } from "@/layout/index";
import type { Session } from "../daemon/sessions/reduce";
import { nextWaiting, Target } from "./sessions";

// Every Wave tab runs in its own renderer, so a renderer can only magnify blocks of its own
// tab. To reach a block elsewhere we leave the target in localStorage, which all renderers
// share, and switch tab; the target tab's renderer picks it up.
const HANDOFF = "wintos:focus";
const HANDOFF_TTL_MS = 5000;

let latest: { sessions: Session[]; tabIds: string[] } = { sessions: [], tabIds: [] };
export const setLatestSessions = (sessions: Session[], tabIds: string[]) => (latest = { sessions, tabIds });

export function magnifyBlock(blockId: string): boolean {
    const lm = getLayoutModelForStaticTab();
    const node = lm?.getNodeByBlockId(blockId);
    if (!node) return false;
    if (globalStore.get(lm.magnifiedNodeIdAtom) !== node.id) lm.magnifyNodeToggle(node.id);
    lm.focusNode(node.id);
    return true;
}

export function focusSession(t: Target): void {
    if (t.tabId === globalStore.get(atoms.staticTabId)) {
        magnifyBlock(t.blockId);
        return;
    }
    localStorage.setItem(HANDOFF, JSON.stringify({ ...t, at: Date.now() }));
    getApi().setActiveTab(t.tabId);
}

export function takeHandoff(): void {
    const raw = localStorage.getItem(HANDOFF);
    if (!raw) return;
    const t = JSON.parse(raw) as Target & { at: number };
    if (t.tabId !== globalStore.get(atoms.staticTabId)) return;
    localStorage.removeItem(HANDOFF);
    if (Date.now() - t.at < HANDOFF_TTL_MS) magnifyBlock(t.blockId);
}

export function jumpToNextWaiting(): boolean {
    const lm = getLayoutModelForStaticTab();
    const current = lm && globalStore.get(lm.focusedNode)?.data?.blockId;
    const t = nextWaiting(latest.sessions, latest.tabIds, globalStore.get(atoms.staticTabId), current);
    if (t) focusSession(t);
    return true;
}
