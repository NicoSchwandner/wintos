import { globalStore } from "@/app/store/jotaiStore";
import { atoms, getApi } from "@/store/global";
import { getLayoutModelForStaticTab } from "@/layout/index";
import type { Session } from "../daemon/sessions/reduce";
import { nextNeedsYou, Target } from "./sessions";
import { editingMineAtom, findInNotesAtom, isPage, mainViewAtom, overlayAtom, type Overlay } from "./notes/state";
import { rememberReturn, returnFocus, wantPane } from "./focusOwner";
import { daemonFetch, setProjectSnoozed } from "./useWintos";
import { flog, where } from "./focusLog";
import { inboxKind } from "./view";
import { getWaveObjectAtom, makeORef } from "@/app/store/wos";

// Every Wave tab runs in its own renderer, so a renderer can only magnify blocks of its own
// tab. To reach a block elsewhere we leave the target in localStorage, which all renderers
// share, and switch tab; the target tab's renderer picks it up.
const HANDOFF = "wintos:focus";
const HANDOFF_TTL_MS = 5000;

let latest: { sessions: Session[]; tabIds: string[]; needs: string[]; snoozed: string[] } = { sessions: [], tabIds: [], needs: [], snoozed: [] };
export const setLatestSessions = (sessions: Session[], tabIds: string[], needs: string[], snoozed: string[] = []) => (latest = { sessions, tabIds, needs, snoozed });
export const isSnoozedProject = (tabId: string) => latest.snoozed.includes(tabId);
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
// Opening a snoozed project (from its PR, the palette, the Snoozed group) wakes it.
// Where the walks (⌘J/⌘K, ⌃⇥) start: what is showing. The cards above the projects are in the
// walk as card:prs, card:oncall and card:today; a page with no card (Keyboard) is outside it.
export function whereYouAre(): string {
    const view = globalStore.get(mainViewAtom);
    if (view === "day") return "card:today";
    if (isPage(view)) return "";
    const tabId = globalStore.get(atoms.staticTabId);
    const kind = inboxKind(globalStore.get(getWaveObjectAtom<Tab>(makeORef("tab", tabId))));
    return kind ? `card:${kind}` : tabId;
}

export function enterProject(tabId: string, find?: string): void {
    if (isSnoozedProject(tabId)) void setProjectSnoozed(tabId, false);
    focusSession({ tabId, blockId: "", ...(find ? { find } : {}) });
}

// A closed project comes back in a new tab: the tab is created here, and its renderer, the
// only one starting up just then, takes the project's folder over (takeReopen).
const REOPEN = "wintos:reopen";
export function reopenProject(projectId: string): void {
    localStorage.setItem(REOPEN, JSON.stringify({ projectId, at: Date.now() }));
    getApi().createTab();
}
export function takeReopen(): void {
    const raw = localStorage.getItem(REOPEN);
    if (!raw) return;
    localStorage.removeItem(REOPEN);
    const r = JSON.parse(raw) as { projectId: string; at: number };
    if (Date.now() - r.at >= HANDOFF_TTL_MS) return;
    const tabId = globalStore.get(atoms.staticTabId);
    flog(`reopen project ${r.projectId.slice(0, 6)} in this tab`);
    void daemonFetch(`/projects/${encodeURIComponent(r.projectId)}/reopen`, { method: "POST", body: { tabId } });
}

export function focusSession(t: Target): void {
    if (t.tabId === globalStore.get(atoms.staticTabId)) return landOn(t);
    localStorage.setItem(HANDOFF, JSON.stringify({ ...t, at: Date.now() }));
    getApi().setActiveTab(t.tabId);
}

// Arriving in a project: on the session asked for, else back in an unsaved mine.md edit (its
// view left as it was, so the draft stays), else on the terminals.
function landOn({ blockId, find }: Target): void {
    if (find) {
        rememberReturn();
        globalStore.set(findInNotesAtom, find);
        return globalStore.set(mainViewAtom, "notes");
    }
    if (!blockId && mineEditor()) return focusMineEditor();
    globalStore.set(mainViewAtom, "terminal"); // a session behind a view would stay hidden
    wantPane(blockId ? "landing on a session" : "landing on the terminals");
    if (!blockId) return focusArea("terminal");
    // Magnify is a mode you choose (⌘M): landing on a session keeps it, never starts it. An
    // Inbox tab is always in it (one page at a time).
    const lm = getLayoutModelForStaticTab();
    if (lm && globalStore.get(lm.magnifiedNodeIdAtom)) magnifyBlock(blockId);
    else focusBlock(blockId);
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
    landOn(t);
}

export function focusedSession(): Session | undefined {
    const lm = getLayoutModelForStaticTab();
    const blockId = lm && globalStore.get(lm.focusedNode)?.data?.blockId;
    return latest.sessions.find((s) => s.blockId === blockId) ?? latest.sessions.find((s) => s.tabId === globalStore.get(atoms.staticTabId));
}

// ⌘H ⌘L in a project: the focused terminal, the notes rail. The sidebar never takes focus (⌘J/⌘K switch).
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
export function editMine(on: boolean): void {
    // ⌘E with the edit already open (focus went elsewhere) takes you back into it.
    if (on && globalStore.get(editingMineAtom)) return focusMineEditor();
    // A project with no title has no mine.md yet: ⌘E there opens nothing, so nothing is left
    // half-open to catch focus later.
    if (on && !document.querySelector("[data-wintos=mine-editable]")) return;
    if (on === globalStore.get(editingMineAtom)) return;
    if (on) rememberReturn();
    globalStore.set(editingMineAtom, on);
    if (!on) returnFocus(() => focusArea("terminal"));
}

// Closing an overlay hands focus back to where it was, unless the chosen action moved it; an
// unmounting input otherwise leaves it on <body>, where no key does anything.
export function toggleOverlay(o: Exclude<Overlay, "">): void {
    const open = globalStore.get(overlayAtom);
    if (open === o) return closeOverlay();
    flog(`overlay ${o} opens`);
    if (!open) rememberReturn();
    globalStore.set(overlayAtom, o);
}

export function closeOverlay(): void {
    flog("overlay closes");
    globalStore.set(overlayAtom, "");
    returnFocus(() => focusArea("terminal"), true);
}

const BEFORE_JUMP = "wintos:before-jump";

// ⌃⇧⇥: back to where the last ⌃⇥ jumped from.
export function jumpBack(): boolean {
    try {
        const t = JSON.parse(localStorage.getItem(BEFORE_JUMP) ?? "null") as Target | null;
        if (!t || !latest.tabIds.includes(t.tabId)) return true;
        localStorage.removeItem(BEFORE_JUMP);
        focusSession(t);
    } catch {}
    return true;
}

export function jumpToNextWaiting(): boolean {
    const lm = getLayoutModelForStaticTab();
    const current = lm && globalStore.get(lm.focusedNode)?.data?.blockId;
    const t = nextNeedsYou(latest.sessions, latest.tabIds, whereYouAre(), current, latest.needs);
    // Where this jump started, for ⌃⇧⇥ to go back to.
    if (t) localStorage.setItem(BEFORE_JUMP, JSON.stringify({ tabId: globalStore.get(atoms.staticTabId), blockId: current ?? "" }));
    // A project in Needs you for its PR has no session to magnify: just its terminals.
    if (t) focusSession("blockId" in t ? t : { tabId: t.tabId, blockId: "" });
    return true;
}
