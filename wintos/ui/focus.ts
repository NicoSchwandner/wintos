import { globalStore } from "@/app/store/jotaiStore";
import { atoms, getApi } from "@/store/global";
import { getLayoutModelForStaticTab } from "@/layout/index";
import type { Session } from "../daemon/sessions/reduce";
import { nextNeedsYou, Target } from "./sessions";
import { editingMineAtom, mainViewAtom, overlayAtom, type Overlay } from "./notes/state";
import { wantPane } from "./focusOwner";
import { flog, where } from "./focusLog";

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

export function focusBlock(blockId: string): void {
    const lm = getLayoutModelForStaticTab();
    const node = lm?.getNodeByBlockId(blockId);
    if (node) lm.focusNode(node.id);
}

// Every project switch: the project opens on its terminals. Views are per renderer, so a PR
// view left open in a project would otherwise greet you there later.
export const enterProject = (tabId: string) => focusSession({ tabId, blockId: "" });

export function focusSession(t: Target): void {
    if (t.tabId === globalStore.get(atoms.staticTabId)) return landOn(t.blockId);
    localStorage.setItem(HANDOFF, JSON.stringify({ ...t, at: Date.now() }));
    getApi().setActiveTab(t.tabId);
}

// Arriving in a project: on the session asked for, else back in an unsaved mine.md edit (its
// view left as it was, so the draft stays), else on the terminals.
function landOn(blockId: string): void {
    if (!blockId && mineEditor()) return focusMineEditor();
    globalStore.set(mainViewAtom, "terminal"); // a session behind a view would stay hidden
    wantPane(blockId ? "landing on a session" : "landing on the terminals");
    if (blockId) magnifyBlock(blockId);
    else focusArea("terminal");
}

const mineEditor = () => document.querySelector<HTMLElement>("[data-wintos=mine-editor]");
const focusMineEditor = () => void requestAnimationFrame(() => mineEditor()?.focus());

export function takeHandoff(): void {
    const raw = localStorage.getItem(HANDOFF);
    if (!raw) return;
    const t = JSON.parse(raw) as Target & { at: number };
    if (t.tabId !== globalStore.get(atoms.staticTabId)) return;
    localStorage.removeItem(HANDOFF);
    if (Date.now() - t.at >= HANDOFF_TTL_MS) return;
    landOn(t.blockId);
}

export function focusedSession(): Session | undefined {
    const lm = getLayoutModelForStaticTab();
    const blockId = lm && globalStore.get(lm.focusedNode)?.data?.blockId;
    return latest.sessions.find((s) => s.blockId === blockId) ?? latest.sessions.find((s) => s.tabId === globalStore.get(atoms.staticTabId));
}

// ⌘1 ⌘2 in a project: the focused terminal, the notes rail. The sidebar never takes focus (⌘J/⌘K switch).
export function focusArea(area: "terminal" | "notes"): void {
    if (area === "terminal") wantPane("to the panes");
    globalStore.set(mainViewAtom, "terminal");
    // After the view switch renders: a hidden terminal or unmounted rail can't take focus.
    requestAnimationFrame(() => {
        if (area === "notes") return void document.querySelector<HTMLElement>("[data-wintos=notes-rail]")?.focus();
        const lm = getLayoutModelForStaticTab();
        const node = lm && globalStore.get(lm.focusedNode);
        if (node) lm.focusNode(node.id);
        // A terminal takes focus in its hidden textarea, a browser pane in its page.
        document.querySelector<HTMLElement>(`[data-blockid="${node?.data?.blockId}"] :is(.xterm-helper-textarea, webview)`)?.focus();
    });
}

// ⌘E edits mine.md from anywhere; save or esc hands focus back to where the edit started.
let beforeEdit: HTMLElement | null = null;
export function editMine(on: boolean): void {
    // ⌘E with the edit already open (focus went elsewhere) takes you back into it.
    if (on && globalStore.get(editingMineAtom)) return focusMineEditor();
    // A project with no title has no mine.md yet: ⌘E there opens nothing, so nothing is left
    // half-open to catch focus later.
    if (on && !document.querySelector("[data-wintos=mine-editable]")) return;
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
    flog(`overlay ${o} opens`);
    if (!open) beforeOverlay = document.activeElement as HTMLElement | null;
    globalStore.set(overlayAtom, o);
}

export function closeOverlay(): void {
    flog(`overlay closes, back to ${where(beforeOverlay)}`);
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
