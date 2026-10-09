import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";
import { appHandleKeyDown, getDefaultNewBlockDef } from "@/app/store/keymodel";
import { getWaveObjectAtom, makeORef } from "@/app/store/wos";
import { atoms, createBlock, createTab, getApi, getBlockComponentModel, isDev } from "@/store/global";
import { closeOverlay, editMine, enterProject, focusArea, focusSession, takeReopen, focusBlock, isSnoozedProject, focusedSession, latestSessions, magnifyBlock, toggleOverlay } from "./focus";
import { closeWarning, paneCloseWarns } from "./sessions";
import { toggleInbox } from "./inbox";
import { FLAG_EVENT, mainViewAtom, overlayAtom, renamingAtom, restartArmedAtom, closeArmedAtom, tickModeAtom, type MainView } from "./notes/state";
import { stepProject, switchProject, topProject } from "./switcher";
import { getLayoutModelForStaticTab, LayoutTreeActionType, NavigateDirection, type LayoutTreeSwapNodeAction } from "@/layout/index";
import { railCollapsedAtom, setRailCollapsed } from "./notes/railWidth";
import { isInboxTab, sessionHeader, urgentPr } from "./view";
import { closeAction, escapeAction, zoneOf } from "./zones";
import { paneOrder } from "./panes";
import { installFocusRing } from "./focusRing";
import { currentState, daemonFetch, parkBlock, setProjectSnoozed } from "./useWintos";
import { flog } from "./focusLog";
import { meetingToJoin } from "./meetings";
import { installKeyGame } from "./keyGame";
import { ClientService } from "@/app/store/services";
import { ClientModel } from "@/app/store/client-model";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { CurrentOnboardingVersion } from "@/app/onboarding/onboarding-common";
import { installFocusOwner, paneWanted, rememberReturn, returnFocus, wantPane } from "./focusOwner";

// Menu-bar actions that replace Wave's widget bar. They open the blocks the widget config
// defines, so a user's widgets.json overrides still apply.
const WIDGET_FOR: Record<string, string> = {
    terminal: "defwidget@terminal",
    browser: "defwidget@web",
    files: "defwidget@files",
    sysinfo: "defwidget@sysinfo",
    processes: "defwidget@processviewer",
};

export function blockDefFor(action: string, widgets: Record<string, WidgetConfigType> | undefined): { def: BlockDef; ephemeral: boolean } | null {
    if (action === "settings") return { def: { meta: { view: "waveconfig" } }, ephemeral: true };
    const def = widgets?.[WIDGET_FOR[action]]?.blockdef;
    return def ? { def, ephemeral: false } : null;
}

const shQuote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

export function newSessionScript(cwd: string | undefined): string {
    return cwd ? `cd ${shQuote(cwd)} && claude` : "claude";
}

// ⇧⌘T: another Claude session in this project, next to the focused one and in its directory.
function newSession(): void {
    const cwd = focusedSession()?.cwd;
    createBlock({ meta: { view: "term", controller: "shell", "cmd:initscript": newSessionScript(cwd) } });
}

// Every WintOS key, bound in Wave's global key map so a focused terminal can't swallow it
// first (Wave's own term handler once ate ⌘K). The menu repeats them for discoverability.
export const WINTOS_KEYS: [string, string][] = [
    ["Cmd:j", "switch-next"],
    ["Cmd:k", "switch-prev"],
    ["Cmd:n", "project"],
    ["Cmd:r", "rename"],
    ["Cmd:t", "terminal"],
    ["Shift:Cmd:t", "session"],
    ["Shift:Cmd:w", "close-project"],
    ["Cmd:e", "edit-mine"],
    ["Shift:Cmd:p", "palette"],
    ["Shift:Cmd:k", "keymap"],
    ["Shift:Cmd:l", "notes"],
    ["Shift:Cmd:g", "prs"],
    ["Shift:Cmd:o", "panel"],
    ["Shift:Cmd:b", "browser"],
    ["Shift:Cmd:f", "files"],
    // ⌥ turns a letter into another character on macOS (⌥J is º), so these match the key's
    // place; j and k sit in the same place on QWERTY and QWERTZ.
    ["Option:Cmd:c{KeyJ}", "pane-down"],
    ["Option:Cmd:c{KeyK}", "pane-up"],
    ["Shift:Cmd:c", "copy-url"],
    ["Option:Cmd:z", "snooze-project"],
    ["Option:Cmd:p", "park-session"],
    ["Option:Cmd:g", "open-pane-pr"],
    ["Shift:Cmd:j", "join-meeting"],
    ["Shift:Cmd:y", "day"],
    ["Shift:Cmd:i", "keyboard"],
    ["Shift:Cmd:u", "open-external"],
    ["Option:Cmd:s", "show-snoozed"],
    ["Option:Cmd:r", "restart-terminal"],
    ["Option:Cmd:x", "tick"],
    ["Option:Cmd:c{KeyL}", "rail"],
    ["Ctrl:Cmd:c{KeyH}", "carry-left"],
    ["Ctrl:Cmd:c{KeyJ}", "carry-down"],
    ["Ctrl:Cmd:c{KeyK}", "carry-up"],
    ["Ctrl:Cmd:c{KeyL}", "carry-right"],
    // ⌥ turns a digit into another character too, so these match the key's place.
    ...Array.from({ length: 9 }, (_, i): [string, string] => [`Option:Cmd:c{Digit${i + 1}}`, `unshelve-${i + 1}`]),
    ["Cmd:h", "focus-left"],
    ["Cmd:l", "focus-right"],
];

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

// ⌥⌘J/K: the pane below / above, in a split stacked with ⇧⌘D. Where one pane shows at a time (an
// Inbox tab, a magnified pane) they step to the next / previous pane in strip order instead.
function movePane(dir: NavigateDirection): boolean {
    const lm = getLayoutModelForStaticTab();
    if (inInbox() || globalStore.get(lm.magnifiedNodeIdAtom)) return stepPane(dir === NavigateDirection.Left || dir === NavigateDirection.Up ? -1 : 1);
    wantPane("⌥⌘J/K");
    lm.switchNodeFocusInDirection(dir, false); // at the edge nothing moves
    return true;
}

// ⌃⌘H/J/K/L: the focused pane trades places with its neighbour that way and keeps the focus;
// at the edge nothing moves.
function carryPane(dir: NavigateDirection): boolean {
    const lm = getLayoutModelForStaticTab();
    if (inInbox() || globalStore.get(lm.magnifiedNodeIdAtom)) return false;
    const from = globalStore.get(lm.focusedNode)?.id;
    if (!from) return false;
    lm.switchNodeFocusInDirection(dir, false);
    const to = globalStore.get(lm.focusedNode)?.id;
    if (to && to !== from) {
        lm.treeReducer({ type: LayoutTreeActionType.Swap, node1Id: from, node2Id: to } as LayoutTreeSwapNodeAction);
        lm.focusNode(from);
    }
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

// The previous/next pane of this tab, in layout order, wrapping.
function stepPane(delta: 1 | -1): boolean {
    const lm = getLayoutModelForStaticTab();
    const ids = paneOrder(globalStore.get(lm.leafOrder), globalStore.get(getWaveObjectAtom<Tab>(makeORef("tab", globalStore.get(atoms.staticTabId))))?.blockids ?? []);
    wantPane("⌥⌘J/K");
    const next = stepProject(ids, globalStore.get(lm.focusedNode)?.data?.blockId ?? "", delta);
    // The Inbox reads one page at a time, and a magnified pane stays magnified; a split in a
    // project stays side by side and only the focus moves.
    if (next) inInbox() || globalStore.get(lm.magnifiedNodeIdAtom) ? magnifyBlock(next) : focusBlock(next);
    return true;
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
    const dir = { "pane-up": NavigateDirection.Up, "pane-down": NavigateDirection.Down }[action];
    if (dir !== undefined) return movePane(dir);
    const carry = { "carry-left": NavigateDirection.Left, "carry-right": NavigateDirection.Right, "carry-up": NavigateDirection.Up, "carry-down": NavigateDirection.Down }[action];
    if (carry !== undefined) return carryPane(carry);
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

// The Inbox holds pages and nothing else: a terminal or a Claude session started there would
// belong to no project and never show in the sidebar, Needs you or ⌃⇥.
const PANE_MAKERS = new Set(["session", "terminal", "browser", "files", "sysinfo", "processes", "open-page"]);
const NOT_IN_INBOX = new Set(["session", "terminal", "files", "sysinfo", "processes", "rename", "edit-mine", "notes", "snooze-project", "park-session"]);
export const allowedInInbox = (action: string) => !NOT_IN_INBOX.has(action);
const inInbox = () => isInboxTab(globalStore.get(getWaveObjectAtom<Tab>(makeORef("tab", globalStore.get(atoms.staticTabId)))));

export function runAction(action: string): void {
    flog(`action ${action}`);
    if (action.startsWith("pane-")) return void runKey(action); // from the app menu
    if (!allowedInInbox(action) && inInbox()) return;
    // A pane you create is where you want to be (from the notes too); in an Inbox tab a page
    // opened from the list leaves you in the list.
    if (!inInbox() && PANE_MAKERS.has(action.split(":")[0])) wantPane("new pane");
    if (action === "session") return newSession();
    if (action === "switch-next" || action === "switch-prev") return switchProject(action === "switch-next" ? 1 : -1, false);
    if (action === "project") return void createTab();
    if (action === "close-project") return closeProject();
    if (action === "edit-mine") return editMine(true);
    // Wave's own new-terminal def: the focused terminal's directory and connection.
    if (action === "terminal") return void createBlock(getDefaultNewBlockDef());
    if (action === "rename") return globalStore.set(renamingAtom, globalStore.get(atoms.staticTabId));
    if (action === "palette" || action === "keymap") return toggleOverlay(action);
    // ⌘H / ⌘L: the left and the right area, the same in every tab (the sidebar never takes
    // focus): the Inbox's list and its page, a project's terminals and its notes.
    // ⌥⌘Z: this project is done for now; the same key, or opening it, brings it back.
    // You read the turn and nothing is yours: it waits on something outside, as with `wintos wait`.
    // The focused session if it waits on you, else every one in this project that does.
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
    if (action === "park-session") {
        const tabId = globalStore.get(atoms.staticTabId);
        const waiting = latestSessions().filter((s) => s.tabId === tabId && s.state === "waiting");
        const focused = focusedSession();
        for (const s of focused?.state === "waiting" ? [focused] : waiting) void parkBlock(s.blockId);
        return;
    }
    if (action === "snooze-project") {
        const tabId = globalStore.get(atoms.staticTabId);
        return void setProjectSnoozed(tabId, !isSnoozedProject(tabId));
    }
    if (action === "focus-left" || action === "focus-right") return stepSideways(action === "focus-right");
    if (action.startsWith("focus-")) return focusArea(action.slice(6) as "terminal" | "notes");
    if (action.startsWith("open-page:")) return openPage(action.slice("open-page:".length));
    if (action.startsWith("open-url:")) return void createBlock({ meta: { view: "web", url: action.slice(9) } });
    // PRs and on call live in the Inbox tab, whichever project you are in.
    if (action === "prs") return toggleInbox("prs");
    if (action === "panel" || action.startsWith("panel:")) return toggleInbox("oncall");
    if (action === "notes") return toggleView("notes");
    if (action === "day") return toggleView("day");
    if (action === "keyboard") return toggleView("keyboard");
    if (action === "open-external") return openExternal();
    if (action === "tick") return void (rememberReturn(), globalStore.set(tickModeAtom, true));
    if (action === "show-snoozed") return toggleStoredFlag("wintos:show-snoozed");
    if (action === "restart-terminal") return restartTerminal();
    if (action.startsWith("unshelve-")) return unshelve(Number(action.slice("unshelve-".length)));
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
    });
    if (action === "overlay") closeOverlay();
    if (action === "view") closeNotesView();
    if (action === "pane") {
        if (!confirmPaneClose(focused?.data?.blockId)) return true;
        shelvePane(focused?.data?.blockId);
    }
    return action !== "pane";
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

// ⌥⌘1–9: the project's shelved sessions, newest first, back as a pane.
function unshelve(n: number): void {
    const tabId = globalStore.get(atoms.staticTabId);
    const s = currentState()?.shelf?.[tabId]?.[n - 1];
    if (s) focusSession({ tabId, blockId: "", resume: s.script });
}

// Closing a Claude session's pane keeps it on the project's shelf, to resume from ⇧⌘P. A session
// you ended with /exit has no resume command (the hook clears it) and just closes.
export function shelvePane(blockId: string | undefined): void {
    const script = blockId && shelvable(globalStore.get(getWaveObjectAtom<Block>(makeORef("block", blockId)))?.meta);
    if (!script) return;
    const label = currentState()?.sessions.find((s) => s.blockId === blockId)?.label;
    void daemonFetch(`/projects/${encodeURIComponent(globalStore.get(atoms.staticTabId))}/shelf`, { method: "POST", body: { script, label } });
}
export const shelvable = (meta: MetaType | undefined): string | undefined => {
    const script = meta?.["cmd:initscript"];
    return typeof script === "string" && script.includes(" claude --resume ") ? script : undefined;
};

// Esc forwarded out of a page in the Inbox hands focus back to its list.
export function wintosEscape(): boolean {
    const active = document.activeElement;
    // The notes full width is a view opened on top: Esc closes it, back to where you were.
    if (!globalStore.get(overlayAtom) && globalStore.get(mainViewAtom) !== "terminal" && zoneOf(active) === "list") return closeNotesView(), true;
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

// ⇧⌘W: asks first when Claude sessions would stop; ⇧⌘W again confirms.
function closeProject(): void {
    const tabId = globalStore.get(atoms.staticTabId);
    if (isInboxTab(globalStore.get(getWaveObjectAtom<Tab>(makeORef("tab", tabId))))) return; // the Inbox is never closed
    if (globalStore.get(overlayAtom) !== "confirm-close" && closeWarning(latestSessions(), tabId)) return toggleOverlay("confirm-close");
    globalStore.set(overlayAtom, "");
    closeProjectTab(tabId, false);
}

// Closing the open project lands on the uppermost one in the sidebar, not on Wave's neighbour tab.
export function closeProjectTab(tabId: string, confirm: boolean): void {
    const top = tabId === globalStore.get(atoms.staticTabId) ? topProject(tabId) : undefined;
    if (top) enterProject(top);
    void getApi().closeTab(globalStore.get(atoms.workspace).oid, tabId, confirm);
}

// ⇧⌘L opens the notes full width, and the same key again goes back to the terminals.
// ⇧⌘U: the focused page in the system browser (a sign-in, a call that wants the camera).
function openExternal(): void {
    const blockId = globalStore.get(getLayoutModelForStaticTab().focusedNode)?.data?.blockId;
    const url = blockId && focusedPageUrl(globalStore.get(getWaveObjectAtom<Block>(makeORef("block", blockId))));
    if (url) getApi().openExternal(url);
}

// A sidebar toggle kept in localStorage (Sidebar's useStoredFlag), flipped by a key.
function toggleStoredFlag(key: string): void {
    try {
        localStorage.setItem(key, localStorage.getItem(key) === "1" ? "0" : "1");
    } catch {}
    window.dispatchEvent(new Event(FLAG_EVENT));
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
    if (globalStore.get(mainViewAtom) === view) return closeNotesView();
    openView(view);
}

// A click on a card opens its page and never closes it: a second click on what is already open
// does nothing. Only the key, pressed again, goes back.
export function openView(view: MainView): void {
    if (globalStore.get(mainViewAtom) === view) return;
    rememberReturn();
    globalStore.set(mainViewAtom, view);
}

// Closing the notes full width (⇧⌘L again, Esc, ⌘W): back to where you opened it from.
function closeNotesView(): void {
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
    installFocusOwner();
    // Wave's openLink (a ⌘-click on a url in a terminal) opens web links through here.
    Object.assign(window, { wintosOpenPage: (url: string) => runAction(`open-page:${url}`) });
    getApi().onWintosMenu(runAction);
    // A link leaving a GitHub page (wintos/links.ts) opens beside it in this tab.
    getApi().onWintosOpenPane((url) => runAction(`open-page:${url}`));
    // Dev builds only: lets wintos/e2e drive menu actions that native menus keep out of reach.
    // A dynamic import() from the harness would load second copies of these modules, not the live ones.
    if (isDev()) Object.assign(window, { wintosAction: runAction, wintosTabId: () => globalStore.get(atoms.staticTabId), wintosKeyDown: appHandleKeyDown, wintosLayout: getLayoutModelForStaticTab, wintosSkipOnboarding: skipOnboarding });
}

// Dev only (wintos/e2e/seed.mjs): a freshly reset dev instance opens Wave's onboarding, which
// switches every shortcut off; this agrees to it and marks it seen, so reloaded windows skip it.
async function skipOnboarding(): Promise<void> {
    await ClientService.AgreeTos();
    await RpcApi.SetMetaCommand(TabRpcClient, { oref: makeORef("client", ClientModel.getInstance().clientId), meta: { "onboarding:lastversion": CurrentOnboardingVersion } });
}
