import { globalStore } from "@/app/store/jotaiStore";
import { atoms, createBlock, getApi } from "@/store/global";
import { getLayoutModelForStaticTab } from "@/layout/index";
import type { Session } from "../daemon/sessions/reduce";
import { Target } from "./sessions";
import { editingMineAtom, isPage, mainViewAtom, overlayAtom, type Overlay } from "./notes/state";
import { rememberReturn, returnFocus, wantPane } from "./focusOwner";
import { currentState, daemonFetch } from "./useWintos";
import { flog, where } from "./focusLog";
import { inboxKind } from "./view";
import { noteResume } from "./resuming";
import { getWaveObjectAtom, makeORef } from "@/app/store/wos";

// Every Wave tab runs in its own renderer, so a renderer can only magnify blocks of its own
// tab. To reach a block elsewhere we leave the target in localStorage, which all renderers
// share, and switch tab; the target tab's renderer picks it up.
const HANDOFF = "wintos:focus";
const HANDOFF_TTL_MS = 5000;

let latest: { sessions: Session[]; targets: Record<string, Target> } = { sessions: [], targets: {} };
export const setLatestSessions = (sessions: Session[], targets: Record<string, Target> = {}) => (latest = { sessions, targets });
// The daemon's snapshot, not the Sidebar's copy: that one lags a pane opened a moment ago.
export const latestSessions = () => currentState()?.sessions ?? latest.sessions;

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
// Where the walks (⌘J/⌘K, ⌃⇥) start: what is showing. The cards above the projects are in the
// walk as card:prs, card:oncall and card:today; a page with no card (Keyboard) is outside it.
export function whereYouAre(): string {
    const view = globalStore.get(mainViewAtom);
    if (view === "day" || view === "reflect") return "card:today";
    if (isPage(view)) return "";
    const tabId = globalStore.get(atoms.staticTabId);
    const kind = inboxKind(globalStore.get(getWaveObjectAtom<Tab>(makeORef("tab", tabId))));
    return kind ? `card:${kind}` : tabId;
}

// Opening a project: on the session behind what needs you there, when something does
// (attention's target), else as you left it.
export function enterProject(tabId: string): void {
    focusSession(latest.targets[tabId] ?? { tabId, blockId: "" });
}

// A closed project comes back in a new tab: the tab is created here, and its renderer, the
// only one starting up just then, takes the project's folder over (takeReopen) and opens the
// panes asked for: the shelved session to resume, or all it had (⌘Z after closing it).
const REOPEN = "wintos:reopen";
// Which project was last reopened, and when, across all windows: a key repeated before the new
// tab's state arrives (⌃⇥ held, a double click) still sees the project closed and would make a
// second tab for it.
const REOPENED = "wintos:reopened";
export function claimReopen(ls: Pick<Storage, "getItem" | "setItem">, projectId: string, now: number): boolean {
    try {
        const last = JSON.parse(ls.getItem(REOPENED) ?? "null") as { projectId: string; at: number } | null;
        if (last?.projectId === projectId && now - last.at < HANDOFF_TTL_MS) return false;
    } catch {}
    ls.setItem(REOPENED, JSON.stringify({ projectId, at: now }));
    return true;
}
export function reopenProject(projectId: string, panes: MetaType[] = []): void {
    if (!claimReopen(localStorage, projectId, Date.now())) return flog(`reopen of ${projectId.slice(0, 6)} again within seconds: ignored`);
    localStorage.setItem(REOPEN, JSON.stringify({ projectId, panes, at: Date.now() }));
    // Opened on a session it had: that pane is the tab's first, so no starter terminal runs a
    // second, empty Claude, and none is swapped out (which raced the layout's orphan cleanup).
    getApi().createTab(panes[0] ? { first: panes[0] } : undefined);
}
export const resumePane = (script: string): MetaType => ({ view: "term", controller: "shell", "cmd:initscript": script });
export function takeReopen(): void {
    const raw = localStorage.getItem(REOPEN);
    if (!raw) return;
    localStorage.removeItem(REOPEN);
    const r = JSON.parse(raw) as { projectId: string; panes: MetaType[]; at: number };
    if (Date.now() - r.at >= HANDOFF_TTL_MS) return;
    const tabId = globalStore.get(atoms.staticTabId);
    flog(`reopen project ${r.projectId.slice(0, 6)} in this tab`);
    for (const p of r.panes) noteResume(p["cmd:initscript"] as string | undefined);
    void daemonFetch(`/projects/${encodeURIComponent(r.projectId)}/reopen`, { method: "POST", body: { tabId } }).then(async () => {
        // The first pane came with the tab (createTab's first); the rest join once the layout
        // has applied its own pending actions, whose orphan cleanup would delete a pane added
        // before it is laid out.
        const rest = r.panes.slice(1);
        if (!rest.length || !(await layoutSettled(tabId))) return;
        for (const meta of rest) await createBlock({ meta });
    });
}

async function layoutSettled(tabId: string): Promise<boolean> {
    for (let i = 0; i < 120; i++) {
        const layoutId = globalStore.get(getWaveObjectAtom<Tab>(makeORef("tab", tabId)))?.layoutstate;
        const layout = layoutId && globalStore.get(getWaveObjectAtom<LayoutState>(makeORef("layout", layoutId)));
        if (layout && !layout.pendingbackendactions?.length && layout.rootnode) return true;
        await new Promise((r) => requestAnimationFrame(r));
    }
    return false;
}

export function focusSession(t: Target): void {
    if (t.tabId === globalStore.get(atoms.staticTabId)) return landOn(t);
    localStorage.setItem(HANDOFF, JSON.stringify({ ...t, at: Date.now() }));
    getApi().setActiveTab(t.tabId);
}

// Arriving in a project: on the session asked for, else back in an unsaved mine.md edit (its
// view left as it was, so the draft stays), else on the terminals.
function landOn({ blockId, resume, restore }: Target): void {
    if (!blockId && mineEditor() && !resume && !restore) return focusMineEditor();
    globalStore.set(mainViewAtom, "terminal"); // a session behind a view would stay hidden
    if (restore) return void createBlock({ meta: restore });
    // Resumed once: a second click while it starts lands on the pane already resuming it.
    if (resume) {
        const lm = getLayoutModelForStaticTab();
        const tab = globalStore.get(getWaveObjectAtom<Tab>(makeORef("tab", globalStore.get(atoms.staticTabId))));
        const there = tab?.blockids?.find((id) => globalStore.get(getWaveObjectAtom<Block>(makeORef("block", id)))?.meta?.["cmd:initscript"] === resume);
        if (there && lm) return focusBlock(there);
        noteResume(resume);
        return void createBlock({ meta: resumePane(resume) });
    }
    wantPane(blockId ? "landing on a session" : "landing on the terminals");
    if (!blockId) return focusArea("terminal");
    // Magnify is a mode you choose (⌘M): landing on a session keeps it, never starts it. An
    // Inbox tab is always in it (one page at a time).
    const lm = getLayoutModelForStaticTab();
    const magnified = lm && globalStore.get(lm.magnifiedNodeIdAtom);
    if (magnified) return void magnifyBlock(blockId);
    focusBlock(blockId);
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
    const sessions = latestSessions();
    return sessions.find((s) => s.blockId === blockId) ?? sessions.find((s) => s.tabId === globalStore.get(atoms.staticTabId));
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

