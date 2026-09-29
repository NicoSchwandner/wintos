import { globalStore } from "@/app/store/jotaiStore";
import { getDefaultNewBlockDef } from "@/app/store/keymodel";
import { getWaveObjectAtom, makeORef } from "@/app/store/wos";
import { atoms, createBlock, createTab, getApi, isDev } from "@/store/global";
import { editMine, focusArea, focusBlock, focusedSession, latestSessions, magnifyBlock, toggleOverlay } from "./focus";
import { closeWarning } from "./sessions";
import { goToInbox } from "./inbox";
import { mainViewAtom, overlayAtom, renamingAtom, type MainView } from "./notes/state";
import { stepProject, switchProject } from "./switcher";
import { getLayoutModelForStaticTab } from "@/layout/index";
import { isInboxTab } from "./view";

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
    ["Shift:Cmd:j", "notes"],
    ["Shift:Cmd:g", "prs"],
    ["Shift:Cmd:o", "panel"],
    ["Shift:Cmd:b", "browser"],
    ["Shift:Cmd:e", "files"],
    ["Option:Cmd:ArrowLeft", "pane-prev"],
    ["Option:Cmd:ArrowRight", "pane-next"],
    ["Shift:Cmd:c", "copy-url"],
    ["Cmd:2", "focus-terminal"],
    ["Cmd:3", "focus-notes"],
];

function focusedBlockView(): string | undefined {
    const blockId = document.activeElement?.closest<HTMLElement>("[data-blockid]")?.dataset.blockid;
    return blockId ? globalStore.get(getWaveObjectAtom<Block>(makeORef("block", blockId)))?.meta?.view : undefined;
}

export const focusedPageUrl = (block: Block | undefined): string | undefined => (block?.meta?.view === "web" ? block.meta.url : undefined);

// ⌥⌘←/→ magnify the previous/next pane of this tab, in layout order, wrapping.
function stepPane(delta: 1 | -1): boolean {
    const lm = getLayoutModelForStaticTab();
    const ids = globalStore.get(getWaveObjectAtom<Tab>(makeORef("tab", globalStore.get(atoms.staticTabId))))?.blockids ?? [];
    const next = stepProject(ids, globalStore.get(lm.focusedNode)?.data?.blockId ?? "", delta);
    if (next) magnifyBlock(next);
    return true;
}

// ⇧⌘C copies the focused browser pane's address, through emain: navigator.clipboard refuses
// while focus is inside the page. Anywhere else ⇧⌘C stays what it was.
function copyUrl(): boolean {
    const blockId = globalStore.get(getLayoutModelForStaticTab().focusedNode)?.data?.blockId;
    const url = blockId && focusedPageUrl(globalStore.get(getWaveObjectAtom<Block>(makeORef("block", blockId))));
    if (!url) return false;
    getApi().writeClipboard(url);
    return true;
}

export function runKey(action: string): boolean {
    if (action === "pane-prev" || action === "pane-next") return stepPane(action === "pane-next" ? 1 : -1);
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
const NOT_IN_INBOX = new Set(["session", "terminal", "files", "sysinfo", "processes", "rename", "edit-mine", "notes", "focus-notes"]);
export const allowedInInbox = (action: string) => !NOT_IN_INBOX.has(action);
const inInbox = () => isInboxTab(globalStore.get(getWaveObjectAtom<Tab>(makeORef("tab", globalStore.get(atoms.staticTabId)))));

export function runAction(action: string): void {
    if (!allowedInInbox(action) && inInbox()) return;
    if (action === "session") return newSession();
    if (action === "switch-next" || action === "switch-prev") return switchProject(action === "switch-next" ? 1 : -1, false);
    if (action === "project") return void createTab();
    if (action === "close-project") return closeProject();
    if (action === "edit-mine") return editMine(true);
    // Wave's own new-terminal def: the focused terminal's directory and connection.
    if (action === "terminal") return void createBlock(getDefaultNewBlockDef());
    if (action === "rename") return globalStore.set(renamingAtom, globalStore.get(atoms.staticTabId));
    if (action === "palette" || action === "keymap") return toggleOverlay(action);
    if (action.startsWith("focus-")) return focusArea(action.slice(6) as "terminal" | "notes");
    if (action.startsWith("open-page:")) return openPage(action.slice("open-page:".length));
    if (action.startsWith("open-url:")) return void createBlock({ meta: { view: "web", url: action.slice(9) } });
    // PRs and on call live in the Inbox tab, whichever project you are in.
    if (action === "prs") return goToInbox("prs");
    if (action === "panel" || action.startsWith("panel:")) return goToInbox("oncall");
    if (action === "notes") return toggleView("notes");
    const b = blockDefFor(action, globalStore.get(atoms.fullConfigAtom)?.widgets);
    if (b) createBlock(b.def, false, b.ephemeral);
}

// ⌘W inside a WintOS view acts on the view: the terminals are hidden behind it, and Wave's
// close would kill the focused one unseen.
export function wintosClose(): boolean {
    if (globalStore.get(mainViewAtom) === "terminal") return false;
    focusArea("terminal");
    return true;
}

// Esc forwarded out of a page in the Inbox hands focus back to its list.
export function wintosEscape(): boolean {
    if (document.activeElement?.tagName !== "WEBVIEW") return false;
    const list = document.querySelector<HTMLElement>("[data-wintos=inbox-list]");
    if (!list) return false;
    list.focus();
    return true;
}

export function paneShowing(blocks: (Block | undefined)[], url: string): string | undefined {
    return blocks.find((b) => b?.meta?.view === "web" && b.meta.url === url)?.oid;
}

// A PR from the project's notes or the palette opens in the project, beside its terminals; the
// PR view keeps its own tabs. One pane per PR: open again, it is focused.
function openPage(url: string): void {
    globalStore.set(mainViewAtom, "terminal");
    const tab = globalStore.get(getWaveObjectAtom<Tab>(makeORef("tab", globalStore.get(atoms.staticTabId))));
    const shown = paneShowing((tab?.blockids ?? []).map((id) => globalStore.get(getWaveObjectAtom<Block>(makeORef("block", id)))), url);
    // In the Inbox a page is read one at a time, like a tab: it is magnified, not tiled.
    const inInbox = isInboxTab(tab);
    if (shown) return inInbox ? void magnifyBlock(shown) : focusBlock(shown);
    void createBlock({ meta: { view: "web", url } }).then((id) => inInbox && setTimeout(() => magnifyBlock(id), 50));
}

// ⇧⌘W: asks first when Claude sessions would stop; ⇧⌘W again confirms.
function closeProject(): void {
    const tabId = globalStore.get(atoms.staticTabId);
    if (isInboxTab(globalStore.get(getWaveObjectAtom<Tab>(makeORef("tab", tabId))))) return; // the Inbox is never closed
    if (globalStore.get(overlayAtom) !== "confirm-close" && closeWarning(latestSessions(), tabId)) return toggleOverlay("confirm-close");
    globalStore.set(overlayAtom, "");
    void getApi().closeTab(globalStore.get(atoms.workspace).oid, tabId, false);
}

// ⇧⌘J opens the notes, and the same key again goes back to the terminals.
export function toggleView(view: MainView): void {
    if (globalStore.get(mainViewAtom) === view) return focusArea("terminal");
    globalStore.set(mainViewAtom, view);
}

let registered = false;
export function registerWintosMenu(): void {
    if (registered) return;
    registered = true;
    getApi().onWintosMenu(runAction);
    // A link leaving a GitHub page (wintos/links.ts) opens beside it in this tab.
    getApi().onWintosOpenPane((url) => runAction(`open-page:${url}`));
    // Dev builds only: lets wintos/e2e drive menu actions that native menus keep out of reach.
    if (isDev()) Object.assign(window, { wintosAction: runAction, wintosTabId: () => globalStore.get(atoms.staticTabId) });
}
