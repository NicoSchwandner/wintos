import { KEY_BINDINGS } from "../actions";
import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";
import { appHandleKeyDown, getDefaultNewBlockDef } from "@/app/store/keymodel";
import { getWaveObjectAtom, makeORef } from "@/app/store/wos";
import { atoms, createBlock, createTab, getApi, getBlockComponentModel, isDev } from "@/store/global";
import { closeOverlay, editMine, enterProject, focusArea, focusSession, reopenProject, resumePane, takeReopen, focusBlock, focusedSession, latestSessions, magnifyBlock, toggleOverlay } from "./focus";
import { atWork, closeWarning, paneCloseWarns, shownState } from "./sessions";
import { toggleInbox } from "./inbox";
import { mainViewAtom, openEpicAtom, overlayAtom, renamingAtom, restartArmedAtom, closeArmedAtom, updateArmedAtom, type MainView } from "./notes/state";
import { switchProject, toRow, topProject } from "./switcher";
import { getLayoutModelForStaticTab, NavigateDirection } from "@/layout/index";
import { railCollapsedAtom, setRailCollapsed } from "./notes/railWidth";
import { isInboxTab, projectSessions, sessionHeader, sessionName, urgentPr } from "./view";
import { rememberUndo, takeUndo } from "./undo";
import { closeAction, escapeAction, isTextField, zoneOf } from "./zones";
import { paneOrder } from "./panes";
import { installKeyHold } from "./keyHold";
import { installFocusRing } from "./focusRing";
import { currentState, daemonFetch, parkBlock } from "./useWintos";
import { flog } from "./focusLog";
import { meetingToJoin } from "./meetings";
import { installKeyGame } from "./keyGame";
import { ClientService } from "@/app/store/services";
import { ClientModel } from "@/app/store/client-model";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { CurrentOnboardingVersion } from "@/app/onboarding/onboarding-common";
import { liveSessionIn } from "../daemon/sessions/reduce";
import { installFocusOwner, paneWanted, rememberReturn, returnFocus, wantPane } from "./focusOwner";

// Menu-bar actions that replace Wave's widget bar. They open the blocks the widget config
// defines, so a user's widgets.json overrides still apply.
const WIDGET_FOR: Record<string, string> = {
    terminal: "defwidget@terminal",
    sysinfo: "defwidget@sysinfo",
    processes: "defwidget@processviewer",
};

export function blockDefFor(action: string, widgets: Record<string, WidgetConfigType> | undefined): { def: BlockDef; ephemeral: boolean } | null {
    if (action === "settings") return { def: { meta: { view: "waveconfig" } }, ephemeral: true };
    const def = widgets?.[WIDGET_FOR[action]]?.blockdef;
    return def ? { def, ephemeral: false } : null;
}

// Every WintOS key (wintos/actions.ts), bound in Wave's global key map so a focused terminal can't
// swallow it first (Wave's own term handler once ate ⌘K).
export const WINTOS_KEYS: [string, string][] = KEY_BINDINGS;

function focusedBlockView(): string | undefined {
    const blockId = document.activeElement?.closest<HTMLElement>("[data-blockid]")?.dataset.blockid;
    return blockId ? globalStore.get(getWaveObjectAtom<Block>(makeORef("block", blockId)))?.meta?.view : undefined;
}

export const focusedPageUrl = (block: Block | undefined): string | undefined => (block?.meta?.view === "web" ? block.meta.url : undefined);

function stepInbox(right: boolean): void {
    if (zoneOf(document.activeElement) !== "pane") return right && tabPanes().length ? focusArea("terminal") : undefined;
    if (!stepShown(right) && !right) document.querySelector<HTMLElement>("[data-wintos=inbox-list]")?.focus(); // left of the first page is the list
}

const tabPanes = () =>
    paneOrder(globalStore.get(getLayoutModelForStaticTab().leafOrder), globalStore.get(getWaveObjectAtom<Tab>(makeORef("tab", globalStore.get(atoms.staticTabId))))?.blockids ?? []);

// Where one pane shows at a time (an Inbox tab, a magnified pane), ⌘H/⌘L show the previous / next
// one in strip order; false at either end.
function stepShown(right: boolean): boolean {
    const lm = getLayoutModelForStaticTab();
    const pages = tabPanes();
    const magnified = globalStore.get(lm.magnifiedNodeIdAtom);
    const shown = pages.find((id) => lm.getNodeByBlockId(id)?.id === magnified) ?? globalStore.get(lm.focusedNode)?.data?.blockId;
    const next = pages[pages.indexOf(shown ?? "") + (right ? 1 : -1)];
    if (!next) return false;
    wantPane("⌘H/⌘L");
    magnifyBlock(next);
    return true;
}

// ⌘H / ⌘L: one step left or right in what you see. In a project from pane to pane, and past the
// rightmost pane into the notes (opening the rail if it is folded away). In an Inbox tab the
// list, then its pages in strip order, each brought to the front: list ← page ← page.
function stepSideways(right: boolean): void {
    if (inInbox()) return stepInbox(right);
    const zone = zoneOf(document.activeElement);
    // The notes are the rightmost thing: ⌘H goes back to the terminals, ⌘L stays.
    if (zone === "list" || globalStore.get(mainViewAtom) !== "terminal") return right ? undefined : focusArea("terminal");
    const lm = getLayoutModelForStaticTab();
    const before = globalStore.get(lm.focusedNode)?.id;
    if (zone === "pane" && globalStore.get(lm.magnifiedNodeIdAtom)) {
        if (stepShown(right)) return;
    } else if (zone === "pane") {
        wantPane("⌘H/⌘L");
        lm.switchNodeFocusInDirection(right ? NavigateDirection.Right : NavigateDirection.Left, false);
        if (globalStore.get(lm.focusedNode)?.id !== before) return; // a neighbour pane took it
    }
    // Right of the epic agent's terminal is its epic, before the notes.
    const blockId = globalStore.get(lm.focusedNode)?.data?.blockId;
    const column = right && zone === "pane" && blockId ? document.querySelector<HTMLElement>(`[data-blockid="${blockId}"] [data-wintos=epic-column]`) : null;
    if (column && column.offsetParent) return column.focus();
    if (right) return void (setRailCollapsed(false), focusArea("notes"));
    if (zone !== "pane") focusArea("terminal");
}

// ⌥⌘L: the notes rail folded away or back, focus following it in and out.
function toggleRail(): void {
    const fold = !globalStore.get(railCollapsedAtom);
    setRailCollapsed(fold);
    if (!fold) return focusArea("notes");
    if (document.activeElement?.closest("[data-wintos=notes-rail]")) focusArea("terminal");
}

// ⇧⌘C copies the focused browser pane's address, through emain: navigator.clipboard refuses
// while focus is inside the page. Anywhere else ⇧⌘C stays what it was.
export const copiedAtAtom = atom(0); // the strip's "copied" flash

function copyUrl(): boolean {
    const blockId = globalStore.get(getLayoutModelForStaticTab().focusedNode)?.data?.blockId;
    const url = blockId && focusedPageUrl(globalStore.get(getWaveObjectAtom<Block>(makeORef("block", blockId))));
    if (!url) return false;
    getApi().writeClipboard(url);
    globalStore.set(copiedAtAtom, Date.now());
    return true;
}

export function runKey(action: string): boolean {
    if (action === "copy-url") return copyUrl();
    // ⌘R in a browser pane stays its reload.
    if (action === "rename" && document.activeElement?.tagName === "WEBVIEW") return false;
    // ⌘E in a file preview stays its edit toggle.
    if (action === "edit-mine" && focusedBlockView() === "preview") return false;
    // Only a held ⌘ can end a walk; from the menu, a step switches at once.
    if (action === "switch-next" || action === "switch-prev") switchProject(action === "switch-next" ? 1 : -1, true);
    else runAction(action);
    return true;
}

// The Inbox holds pages and nothing else: a terminal started there would belong to no project
// and never show in the sidebar, Needs you or ⌃⇥.
const PANE_MAKERS = new Set(["terminal", "sysinfo", "processes", "open-page"]);
const NOT_IN_INBOX = new Set(["terminal", "sysinfo", "processes", "rename", "edit-mine", "park-session", "name-session", "epic", "move-session", "take-out"]);
export const allowedInInbox = (action: string) => !NOT_IN_INBOX.has(action);
const inInbox = () => isInboxTab(globalStore.get(getWaveObjectAtom<Tab>(makeORef("tab", globalStore.get(atoms.staticTabId)))));

export function runAction(action: string): void {
    flog(`action ${action}`);
    if (!allowedInInbox(action) && inInbox()) return;
    // A pane you create is where you want to be (from the notes too); in an Inbox tab a page
    // opened from the list leaves you in the list.
    if (!inInbox() && PANE_MAKERS.has(action.split(":")[0])) wantPane("new pane");
    if (action === "switch-next" || action === "switch-prev") return switchProject(action === "switch-next" ? 1 : -1, false);
    if (action === "project") return void createTab();
    if (action === "new-step") return toggleOverlay("new-step");
    if (action === "close-project") return closeProject();
    if (action === "undo") return undo();
    if (action === "edit-mine") return editMine(true);
    // Wave's own new-terminal def: the focused terminal's directory and connection.
    if (action === "terminal") return void createBlock(getDefaultNewBlockDef());
    // ⌘R names the step the focused session is; with none focused, it renames the project.
    if (action === "rename") return focusedSession() ? toggleOverlay("name-session") : globalStore.set(renamingAtom, globalStore.get(atoms.staticTabId));
    if (action === "palette" || action === "keymap") return toggleOverlay(action);
    if (action === "name-session") return focusedSession() ? toggleOverlay("name-session") : undefined;
    if (action === "epic") return focusedSession() ? toggleOverlay("epic") : undefined;
    if (action === "epic-page") {
        const epic = focusedSession()?.epic;
        return epic ? openEpic(epic) : undefined;
    }
    if (action === "move-session") return focusedSession() ? toggleOverlay("move-session") : undefined;
    // Straight out to a view of its own; when it can't go, the move sheet says why.
    if (action === "take-out") return focusedSession() ? void (moveSession("new") && toggleOverlay("move-session")) : undefined;
    // The meeting on now, else the next one, in the system browser: a call wants the camera.
    if (action === "join-meeting") {
        const m = meetingToJoin(Date.now());
        flog(m ? `join meeting ${m.title}` : "join meeting: none with a link today");
        if (m?.url) getApi().openExternal(m.url);
        return;
    }
    if (action === "open-pane-pr") {
        const lm = getLayoutModelForStaticTab();
        const blockId = lm && globalStore.get(lm.focusedNode)?.data?.blockId;
        const state = currentState();
        const pr = blockId && state ? urgentPr(sessionHeader(state, blockId)) : undefined;
        flog(pr ? `open pane pr ${pr.url}` : "open pane pr: none on this pane");
        if (pr) openPage(pr.url);
        return;
    }
    // You read the turn and nothing is yours: it waits on something outside, as with `wintos wait`.
    // The focused session if it waits on you, else every one in this project that does.
    if (action === "park-session") {
        const tabId = globalStore.get(atoms.staticTabId);
        const waiting = latestSessions().filter((s) => s.tabId === tabId && s.state === "waiting");
        const focused = focusedSession();
        for (const s of focused?.state === "waiting" ? [focused] : waiting) {
            void parkBlock(s.blockId);
            rememberUndo({ kind: "park", sessionId: s.id, label: `Paused ${sessionName(s)}` });
        }
        return;
    }
    // ⌘H / ⌘L: the left and the right area, the same in every tab (the sidebar never takes
    // focus): the Inbox's list and its page, a project's terminals and its notes.
    if (action === "focus-left" || action === "focus-right") return stepSideways(action === "focus-right");
    // A page in a pane of its own, for scripts and e2e (window.wintosAction("open-url:…")).
    if (action.startsWith("open-url:")) return void createBlock({ meta: { view: "web", url: action.slice(9) } });
    if (action.startsWith("open-page:")) return openPage(action.slice("open-page:".length));
    // PRs and on call live in the Inbox tab, whichever project you are in.
    if (action === "prs") return toggleInbox("prs");
    if (action === "panel" || action.startsWith("panel:")) return toggleInbox("oncall");
    if (action === "day") return toggleView("day");
    if (action === "reflect") return toggleView("reflect");
    if (action === "keyboard") return toggleView("keyboard");
    if (action === "restart-terminal") return restartTerminal();
    if (action === "update") return updateWintos();
    if (action === "break") return void (flog("break: started"), daemonFetch("/rhythm/break", { method: "POST", body: {} }));
    if (action === "break-later") return void (flog("break: in 10 min"), daemonFetch("/rhythm/snooze", { method: "POST", body: { minutes: 10 } }));
    if (action.startsWith("session-")) return toRow(Number(action.slice("session-".length)));
    if (action === "rail") return toggleRail();
    const b = blockDefFor(action, globalStore.get(atoms.fullConfigAtom)?.widgets);
    if (b) createBlock(b.def, false, b.ephemeral);
}

// ⌘W and Esc resolve by the rules in zones.ts; false hands the key on to Wave's own.
export function wintosClose(): boolean {
    const lm = getLayoutModelForStaticTab();
    const focused = lm && globalStore.get(lm.focusedNode);
    const magnified = lm && globalStore.get(lm.magnifiedNodeIdAtom);
    const action = closeAction({
        overlay: !!globalStore.get(overlayAtom),
        notesShown: globalStore.get(mainViewAtom) !== "terminal",
        zone: zoneOf(document.activeElement),
        paneFocused: !!focused,
        paneHidden: !!magnified && magnified !== focused?.id,
        emptyProject: !inInbox() && !globalStore.get(getWaveObjectAtom<Tab>(makeORef("tab", globalStore.get(atoms.staticTabId))))?.blockids?.length,
    });
    if (action === "project") closeProjectTab(globalStore.get(atoms.staticTabId), false);
    if (action === "overlay") closeOverlay();
    if (action === "view") closeView();
    if (action === "pane") {
        if (!confirmPaneClose(focused?.data?.blockId)) return true;
        shelvePane(focused?.data?.blockId);
    }
    return action !== "pane";
}

// ⌘W on a pane, or its ×: a working session's pane asks first, then the pane goes to the shelf.
export function closePane(blockId: string): void {
    if (!confirmPaneClose(blockId)) return;
    shelvePane(blockId);
    const lm = getLayoutModelForStaticTab();
    const node = lm.getNodeByBlockId(blockId);
    if (node) void lm.closeNode(node.id);
}

// True when the pane may close now; a working session's pane first asks for a second ⌘W.
export function confirmPaneClose(blockId: string | undefined): boolean {
    if (!blockId || !paneCloseWarns(currentState()?.sessions ?? [], blockId, globalStore.get(closeArmedAtom))) {
        globalStore.set(closeArmedAtom, null);
        return true;
    }
    globalStore.set(closeArmedAtom, blockId);
    setTimeout(() => globalStore.get(closeArmedAtom) === blockId && globalStore.set(closeArmedAtom, null), 3000);
    return false;
}

// The rail's sessions (live, then shelved), by number: back to its pane, or resumed.
export function toSession(n: number): void {
    const tabId = globalStore.get(atoms.staticTabId);
    const state = currentState();
    const blockIds = globalStore.get(getWaveObjectAtom<Tab>(makeORef("tab", tabId)))?.blockids ?? [];
    const x = state && projectSessions(state, tabId, blockIds)[n - 1];
    if (x) focusSession(x.kind === "live" ? { tabId, blockId: x.session.blockId } : { tabId, blockId: "", resume: x.item.script });
}

// Closing a Claude session's pane keeps it on the project's shelf, to resume from ⇧⌘P. A session
// you ended with /exit has no resume command (the hook clears it) and just closes.
// Any pane closed by ⌘W is ⌘Z's to bring back: a session resumes, a page reopens, a terminal
// starts again in its directory.
export function shelvePane(blockId: string | undefined): void {
    const meta = blockId && globalStore.get(getWaveObjectAtom<Block>(makeORef("block", blockId)))?.meta;
    const session = blockId && liveSessionIn(currentState()?.sessions ?? [], blockId);
    if (meta) rememberUndo({ kind: "pane", tabId: globalStore.get(atoms.staticTabId), meta, label: `Closed ${session ? sessionName(session) : meta.view === "web" ? "the page" : "the terminal"}` });
    const script = shelvable(meta || undefined);
    if (!script) return;
    const label = session ? session.label : undefined;
    void daemonFetch(`/projects/${encodeURIComponent(globalStore.get(atoms.staticTabId))}/shelf`, { method: "POST", body: { script, label } });
}
// ⌥⌘M / ⌥⌘T: the focused session moves to another view (a tab), or to a view of its own. Wave
// can't carry a running pane between tabs, so it goes the way ⌘W and ⌥⌘1 do: onto the shelf,
// then resumed where it is going, its epic and name with it. A turn at work would be cut
// off, so it waits for the turn to end. Returns why it can't move, or undefined once on its way.
export const MOVE_SETTLE_MS = 400;
function movable() {
    const lm = getLayoutModelForStaticTab();
    const blockId = lm && globalStore.get(lm.focusedNode)?.data?.blockId;
    const meta = blockId ? globalStore.get(getWaveObjectAtom<Block>(makeORef("block", blockId)))?.meta : undefined;
    const session = blockId ? liveSessionIn(currentState()?.sessions ?? [], blockId) : undefined;
    // A session its epic's agent started in the background shows here through `claude attach`: it
    // moves by attaching elsewhere, and keeps running meanwhile, so a turn at work is no reason to wait.
    const attached = session?.bgId && typeof meta?.["cmd:initscript"] === "string" && meta["cmd:initscript"].includes("claude attach") ? `claude attach ${session.bgId}` : undefined;
    const script = attached ?? shelvable(meta);
    const why = !session || !script ? "only a Claude session that can be resumed moves; this pane has none" : !attached && shownState(session, Date.now()) === "working" ? "it is working: move it once its turn ends" : undefined;
    return { lm, blockId, session, script, why, attached: !!attached };
}
export const moveRefusal = () => movable().why;
export function moveSession(to: string | "new"): string | undefined {
    const { lm, blockId, session, script, why, attached } = movable();
    if (why || !session || !script) return why;
    if (!attached) shelvePane(blockId); // an attached one has nothing to shelve: it runs on in the background
    const node = lm.getNodeByBlockId(blockId!);
    if (node) void lm.closeNode(node.id);
    flog(`move ${session.id.slice(0, 8)} → ${to === "new" ? "a view of its own" : to.slice(0, 6)}`);
    setTimeout(() => (to === "new" ? getApi().createTab({ first: resumePane(script) }) : focusSession({ tabId: to, blockId: "", resume: script })), MOVE_SETTLE_MS);
    return undefined;
}

export const shelvable = (meta: MetaType | undefined): string | undefined => {
    const script = meta?.["cmd:initscript"];
    return typeof script === "string" && script.includes(" claude --resume ") ? script : undefined;
};

// Esc forwarded out of a page in the Inbox hands focus back to its list.
export function wintosEscape(): boolean {
    const active = document.activeElement;
    // The notes full width is a view opened on top: Esc closes it, back to where you were.
    if (!globalStore.get(overlayAtom) && globalStore.get(mainViewAtom) !== "terminal" && zoneOf(active) === "list") return closeView(), true;
    const action = escapeAction({ overlay: !!globalStore.get(overlayAtom), zone: zoneOf(active), inInbox: inInbox(), onPage: active?.tagName === "WEBVIEW" });
    if (action === "overlay") closeOverlay();
    if (action === "panes") focusArea("terminal"); // focusArea declares the pane wanted
    if (action === "list") document.querySelector<HTMLElement>("[data-wintos=inbox-list]")?.focus();
    return action !== "wave";
}

// A PR pane keeps its identity while it moves between the PR's own tabs (/files, /commits).
const pagePr = (url: string) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+(?=[/?#]|$)/.exec(url)?.[0];
// The address a page was opened for: a sign-in or a viewer's own redirect changes its url, and it
// is still that page when opened again.
const OPENED = "wintos:opened";
export function paneShowing(blocks: (Block | undefined)[], url: string): string | undefined {
    const pr = pagePr(url);
    return blocks.find((b) => b?.meta?.view === "web" && (b.meta.url === url || b.meta[OPENED] === url || (pr != null && pagePr(b.meta.url ?? "") === pr)))?.oid;
}

// A PR from the project's notes or the palette opens in the project, beside its terminals; the
// PR view keeps its own tabs. One pane per PR: open again, it is focused.
const opening = new Set<string>();
// ⏎ in the Inbox list shows the page and leaves you in the list, to walk on with j/k: the
// focus owner keeps the page from taking focus (focusOwner.ts). Esc or ⌘L goes to the page.
function openPage(url: string): void {
    globalStore.set(mainViewAtom, "terminal");
    const tab = globalStore.get(getWaveObjectAtom<Tab>(makeORef("tab", globalStore.get(atoms.staticTabId))));
    const shown = paneShowing((tab?.blockids ?? []).map((id) => globalStore.get(getWaveObjectAtom<Block>(makeORef("block", id)))), url);
    // In the Inbox a page is read one at a time, like a tab: it is magnified, not tiled.
    const inInbox = isInboxTab(tab);
    if (shown) {
        if (inInbox) magnifyBlock(shown);
        else focusBlock(shown);
        // Already on screen and focused in the layout, so Wave moves nothing: a wanted pane is
        // focused here (⏎ on a PR whose page is open).
        if (paneWanted()) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-blockid="${shown}"] webview`)?.focus());
        return;
    }
    // The layout node arrives after createBlock resolves, so magnify once it exists (up to ~2s).
    const magnifyWhenLaid = (id: string, frames = 120) => magnifyBlock(id) || (frames > 0 && requestAnimationFrame(() => magnifyWhenLaid(id, frames - 1)));
    // A double ⏎ would otherwise start two panes before either exists.
    if (opening.has(url)) return;
    opening.add(url);
    void createBlock({ meta: { view: "web", url, [OPENED]: url } as MetaType })
        .then((id) => inInbox && magnifyWhenLaid(id))
        .finally(() => opening.delete(url));
}

// ⌘Z (the app menu's Undo): a text field keeps its own undo; anywhere else, a terminal included,
// the last thing WintOS put away comes back.
function undo(): void {
    const active = document.activeElement;
    if (isTextField(active) && !active!.classList.contains("xterm-helper-textarea")) return getApi().nativeUndo();
    const u = takeUndo();
    flog(u ? `undo ${u.kind}: ${u.label}` : "undo: nothing to undo");
    if (!u) return;
    if (u.kind === "pr-snooze") return void daemonFetch("/prs/snooze", { method: "POST", body: { url: u.url, until: null } });
    if (u.kind === "park") return void daemonFetch(`/sessions/${encodeURIComponent(u.sessionId)}/unpark`, { method: "POST", body: {} });
    if (u.kind === "project") return reopenProject(u.projectId, u.metas);
    // A pane whose project was closed since comes back with the project.
    if (globalStore.get(atoms.workspace)?.tabids?.includes(u.tabId)) return focusSession({ tabId: u.tabId, blockId: "", restore: u.meta });
    reopenProject(u.tabId, [u.meta]);
}

// ⇧⌘W: asks first when Claude sessions would stop; ⇧⌘W again confirms.
function closeProject(): void {
    const tabId = globalStore.get(atoms.staticTabId);
    if (isInboxTab(globalStore.get(getWaveObjectAtom<Tab>(makeORef("tab", tabId))))) return; // the Inbox is never closed
    if (globalStore.get(overlayAtom) !== "confirm-close" && closeWarning(latestSessions(), tabId)) return toggleOverlay("confirm-close");
    globalStore.set(overlayAtom, "");
    closeProjectTab(tabId, false);
}

// Closing the open project lands on the uppermost one in the sidebar, not on Wave's neighbour tab.
// land: false for a project closed while you are elsewhere (auto-close), which leaves you there.
export function closeProjectTab(tabId: string, confirm: boolean, land = true): void {
    const top = land && tabId === globalStore.get(atoms.staticTabId) ? topProject(tabId) : undefined;
    if (top) enterProject(top);
    const tab = globalStore.get(getWaveObjectAtom<Tab>(makeORef("tab", tabId)));
    const metas = (tab?.blockids ?? []).map((id) => globalStore.get(getWaveObjectAtom<Block>(makeORef("block", id)))?.meta).filter((m): m is MetaType => !!m);
    rememberUndo({ kind: "project", projectId: tabId, metas, label: `Closed ${currentState()?.projects.find((p) => p.id === tabId)?.title ?? tab?.name ?? "the project"}` });
    // Its sessions go on the shelf first: the resume commands live on the panes the close takes.
    const close = () => void getApi().closeTab(globalStore.get(atoms.workspace).oid, tabId, confirm);
    daemonFetch(`/projects/${encodeURIComponent(tabId)}/shelve-all`, { method: "POST", body: {} }).then(close, close);
}

// ⌥⌘U: WintOS rebuilt and restarted from its checkout, once that has commits the running one
// lacks. A restart ends the turns and subagents running outside tmux, so while one is, the first
// press only asks.
function updateWintos(): void {
    if (!currentState()?.update?.behind) return void flog("update: already up to date");
    const work = atWork(latestSessions(), Date.now(), currentState()?.update?.kept);
    if ((work.working || work.subagents) && !globalStore.get(updateArmedAtom)) {
        globalStore.set(updateArmedAtom, true);
        setTimeout(() => globalStore.set(updateArmedAtom, false), 3000);
        return;
    }
    globalStore.set(updateArmedAtom, false);
    flog("update: restarting");
    void daemonFetch("/update", { method: "POST", body: {} });
}

// ⌥⌘R: the focused terminal's shell started again, for one that hangs (Wave's Force Restart).
// It ends what runs there, a Claude session included, so the first press only asks.
function restartTerminal(): void {
    const blockId = globalStore.get(getLayoutModelForStaticTab().focusedNode)?.data?.blockId;
    const vm = blockId ? (getBlockComponentModel(blockId)?.viewModel as { forceRestartController?: () => Promise<void> } | undefined) : undefined;
    if (!blockId || !vm?.forceRestartController) return void flog("restart terminal: the focused pane is not a terminal");
    if (globalStore.get(restartArmedAtom) !== blockId) {
        globalStore.set(restartArmedAtom, blockId);
        setTimeout(() => globalStore.get(restartArmedAtom) === blockId && globalStore.set(restartArmedAtom, null), 3000);
        return;
    }
    globalStore.set(restartArmedAtom, null);
    flog(`restart terminal ${blockId.slice(0, 6)}`);
    void vm.forceRestartController();
}

export function toggleView(view: MainView): void {
    if (globalStore.get(mainViewAtom) === view) return closeView();
    openView(view);
}

// A click on a card opens its page and never closes it: a second click on what is already open
// does nothing. Only the key, pressed again, goes back.

// An epic's page, from its card on the epics home.
// An epic opens as its agent's view: the agent's terminal with the epic beside it (its mine.md in
// the notes rail). Only an epic with no agent running opens on a page, where a starts one.
export function openEpic(id: string): void {
    const state = currentState();
    const agent = state?.epics?.find((e) => e.id === id)?.agent;
    const live = agent ? state?.sessions.find((s) => s.id === agent && s.state !== "ended") : undefined;
    if (live) return focusSession({ tabId: live.tabId, blockId: live.blockId });
    openEpicPage(id);
}
function openEpicPage(id: string): void {
    globalStore.set(openEpicAtom, id);
    openView("epic");
}

export function openView(view: MainView): void {
    if (globalStore.get(mainViewAtom) === view) return;
    rememberReturn();
    globalStore.set(mainViewAtom, view);
}

// Closing a page over the terminals (Today, the keyboard; its key again, Esc, ⌘W): back to where
// you opened it from.
function closeView(): void {
    globalStore.set(mainViewAtom, "terminal");
    returnFocus(() => focusArea("terminal"));
}

let registered = false;
export function registerWintosMenu(): void {
    if (registered) return;
    registered = true;
    takeReopen();
    installKeyGame();
    installFocusRing();
    installKeyHold();
    installFocusOwner();
    // Wave's openLink (a ⌘-click on a url in a terminal) opens web links through here.
    Object.assign(window, { wintosOpenPage: (url: string) => runAction(`open-page:${url}`) });
    getApi().onWintosMenu(runAction);
    // A link leaving a GitHub page (wintos/links.ts) opens beside it in this tab.
    getApi().onWintosOpenPane((url) => runAction(`open-page:${url}`));
    // Dev builds only: lets wintos/e2e drive menu actions that native menus keep out of reach.
    // A dynamic import() from the harness would load second copies of these modules, not the live ones.
    if (isDev()) Object.assign(window, { wintosAction: runAction, wintosTabId: () => globalStore.get(atoms.staticTabId), wintosKeyDown: appHandleKeyDown, wintosLayout: getLayoutModelForStaticTab, wintosState: currentState, wintosSkipOnboarding: skipOnboarding, wintosRename: (rowKey: string) => globalStore.set(renamingAtom, rowKey) });
}

// Dev only (wintos/e2e/seed.mjs): a freshly reset dev instance opens Wave's onboarding, which
// switches every shortcut off; this agrees to it and marks it seen, so reloaded windows skip it.
async function skipOnboarding(): Promise<void> {
    await ClientService.AgreeTos();
    await RpcApi.SetMetaCommand(TabRpcClient, { oref: makeORef("client", ClientModel.getInstance().clientId), meta: { "onboarding:lastversion": CurrentOnboardingVersion } });
}
