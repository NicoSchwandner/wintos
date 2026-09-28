import { globalStore } from "@/app/store/jotaiStore";
import { atoms, getApi } from "@/store/global";
import { getLayoutModelForStaticTab } from "@/layout/index";
import type { Session } from "../daemon/sessions/reduce";
import { nextNeedsYou, Target } from "./sessions";
import { editingMineAtom, mainViewAtom, overlayAtom, type Overlay } from "./notes/state";

// Every Wave tab runs in its own renderer, so a renderer can only magnify blocks of its own
// tab. To reach a block elsewhere we leave the target in localStorage, which all renderers
// share, and switch tab; the target tab's renderer picks it up.
const HANDOFF = "wintos:focus";
const HANDOFF_TTL_MS = 5000;

let latest: { sessions: Session[]; tabIds: string[]; needs: string[] } = { sessions: [], tabIds: [], needs: [] };
export const setLatestSessions = (sessions: Session[], tabIds: string[], needs: string[]) => (latest = { sessions, tabIds, needs });
export const latestSessions = () => latest.sessions;

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
        globalStore.set(mainViewAtom, "terminal"); // a session behind a view would stay hidden
        if (t.blockId) magnifyBlock(t.blockId);
        else focusArea("terminal");
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
    if (Date.now() - t.at >= HANDOFF_TTL_MS) return;
    globalStore.set(mainViewAtom, "terminal");
    if (t.blockId) magnifyBlock(t.blockId);
    else focusArea("terminal");
}

export function focusedSession(): Session | undefined {
    const lm = getLayoutModelForStaticTab();
    const blockId = lm && globalStore.get(lm.focusedNode)?.data?.blockId;
    return latest.sessions.find((s) => s.blockId === blockId) ?? latest.sessions.find((s) => s.tabId === globalStore.get(atoms.staticTabId));
}

// ⌘2 ⌘3: the focused terminal, the notes rail. The sidebar never takes focus (⌘J/⌘K switch).
export function focusArea(area: "terminal" | "notes"): void {
    globalStore.set(mainViewAtom, "terminal");
    // After the view switch renders: a hidden terminal or unmounted rail can't take focus.
    requestAnimationFrame(() => {
        if (area === "notes") return void document.querySelector<HTMLElement>("[data-wintos=notes-rail]")?.focus();
        const lm = getLayoutModelForStaticTab();
        const node = lm && globalStore.get(lm.focusedNode);
        if (node) lm.focusNode(node.id);
        document.querySelector<HTMLElement>(`[data-blockid="${node?.data?.blockId}"] .xterm-helper-textarea`)?.focus();
    });
}

// ⌘E edits mine.md from anywhere; save or esc hands focus back to where the edit started.
let beforeEdit: HTMLElement | null = null;
export function editMine(on: boolean): void {
    if (on === globalStore.get(editingMineAtom)) return;
    if (on) beforeEdit = document.activeElement as HTMLElement | null;
    globalStore.set(editingMineAtom, on);
    if (on) return;
    const el = beforeEdit;
    beforeEdit = null;
    requestAnimationFrame(() => (el?.isConnected ? el.focus() : focusArea("terminal")));
}

// Closing an overlay hands focus back to where it was, unless the chosen action moved it; an
// unmounting input otherwise leaves it on <body>, where no key does anything.
let beforeOverlay: HTMLElement | null = null;
export function toggleOverlay(o: Exclude<Overlay, "">): void {
    const open = globalStore.get(overlayAtom);
    if (open === o) return closeOverlay();
    if (!open) beforeOverlay = document.activeElement as HTMLElement | null;
    globalStore.set(overlayAtom, o);
}

export function closeOverlay(): void {
    globalStore.set(overlayAtom, "");
    const el = beforeOverlay;
    beforeOverlay = null;
    requestAnimationFrame(() => {
        if (document.activeElement && document.activeElement !== document.body) return; // the action placed focus itself
        el?.isConnected ? el.focus() : focusArea("terminal");
    });
}

export function jumpToNextWaiting(): boolean {
    const lm = getLayoutModelForStaticTab();
    const current = lm && globalStore.get(lm.focusedNode)?.data?.blockId;
    const active = globalStore.get(atoms.staticTabId);
    const t = nextNeedsYou(latest.sessions, latest.tabIds, active, current, latest.needs);
    // A project in Needs you for its PR has no session to magnify: just its terminals.
    if (t) focusSession("blockId" in t ? t : { tabId: t.tabId, blockId: "" });
    return true;
}
