import { globalStore } from "@/app/store/jotaiStore";
import { getDefaultNewBlockDef } from "@/app/store/keymodel";
import { getWaveObjectAtom, makeORef } from "@/app/store/wos";
import { atoms, createBlock, createTab, getApi, isDev } from "@/store/global";
import { editMine, focusArea, focusBlock, focusedSession, latestSessions, toggleOverlay } from "./focus";
import { closeWarning } from "./sessions";
import { mainViewAtom, overlayAtom, panelNameAtom, prCopiedAtom, prTabsAtom, renamingAtom, type MainView } from "./notes/state";
import { closeTab, stepTab } from "./prtabs";
import { switchProject } from "./switcher";
import { pluginPanels } from "./panels";
import { currentState } from "./useWintos";

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
    ["Cmd:ArrowLeft", "browser-back"],
    ["Cmd:ArrowRight", "browser-forward"],
    ["Option:Cmd:ArrowLeft", "tab-prev"],
    ["Option:Cmd:ArrowRight", "tab-next"],
    ["Shift:Cmd:c", "browser-copy-url"],
    ["Shift:Cmd:p", "palette"],
    ["Shift:Cmd:k", "keymap"],
    ["Shift:Cmd:j", "notes"],
    ["Shift:Cmd:g", "prs"],
    ["Shift:Cmd:o", "panel"],
    ["Shift:Cmd:b", "browser"],
    ["Shift:Cmd:e", "files"],
    ["Cmd:2", "focus-terminal"],
    ["Cmd:3", "focus-notes"],
];

function focusedBlockView(): string | undefined {
    const blockId = document.activeElement?.closest<HTMLElement>("[data-blockid]")?.dataset.blockid;
    return blockId ? globalStore.get(getWaveObjectAtom<Block>(makeORef("block", blockId)))?.meta?.view : undefined;
}

// ⌘←/⌘→ and ⌥⌘←/⌥⌘→ act on the PR browser only while it is shown; elsewhere they stay line
// start/end in terminals and back/forward in Wave's web blocks.
function prBrowserKey(action: string): boolean {
    if (globalStore.get(mainViewAtom) !== "prs" || !globalStore.get(prTabsAtom).urls.length) return false;
    if (action === "tab-prev" || action === "tab-next") {
        globalStore.set(prTabsAtom, (t) => stepTab(t, action === "tab-next" ? 1 : -1));
        return true;
    }
    const wv = document.querySelector<Electron.WebviewTag>("[data-wintos=pr-browser] webview[data-active]");
    if (action === "browser-copy-url") {
        const url = wv?.getURL();
        if (!url) return true;
        // Through emain: navigator.clipboard refuses while the focus is inside the page.
        getApi().writeClipboard(url);
        globalStore.set(prCopiedAtom, true);
        setTimeout(() => globalStore.set(prCopiedAtom, false), 1500);
    } else if (action === "browser-back") wv?.goBack();
    else wv?.goForward();
    return true;
}

export function runKey(action: string): boolean {
    if (action.startsWith("browser-") || action.startsWith("tab-")) return prBrowserKey(action);
    // ⌘R in a browser pane stays its reload.
    if (action === "rename" && document.activeElement?.tagName === "WEBVIEW") return false;
    // ⌘E in a file preview stays its edit toggle.
    if (action === "edit-mine" && focusedBlockView() === "preview") return false;
    // Only a held ⌘ can end a walk; from the menu, a step switches at once.
    if (action === "switch-next" || action === "switch-prev") switchProject(action === "switch-next" ? 1 : -1, true);
    else runAction(action);
    return true;
}

export function runAction(action: string): void {
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
    if (action.startsWith("open-pr:")) return openPrHere(action.slice(8));
    if (action.startsWith("open-url:")) return void createBlock({ meta: { view: "web", url: action.slice(9) } });
    if (action.startsWith("panel:")) return openPanel(action.slice(6));
    if (action === "notes" || action === "prs") return toggleView(action);
    if (action === "panel") {
        const first = currentState() && pluginPanels(currentState()!)[0];
        return first ? openPanel(first.name) : undefined;
    }
    const b = blockDefFor(action, globalStore.get(atoms.fullConfigAtom)?.widgets);
    if (b) createBlock(b.def, false, b.ephemeral);
}

// ⌘W inside a WintOS view acts on the view: the terminals are hidden behind it, and Wave's
// close would kill the focused one unseen.
export function wintosClose(): boolean {
    const view = globalStore.get(mainViewAtom);
    if (view === "terminal") return false;
    if (view === "prs" && globalStore.get(prTabsAtom).urls.length) {
        globalStore.set(prTabsAtom, (t) => closeTab(t, t.active));
        document.querySelector<HTMLElement>("[data-wintos=pr-queue]")?.focus();
        return true;
    }
    focusArea("terminal");
    return true;
}

// Esc forwarded out of a page inside a WintOS view hands focus back to that view (its list).
export function wintosEscape(): boolean {
    const el = document.activeElement;
    if (el?.tagName !== "WEBVIEW") return false;
    const view = el.closest<HTMLElement>("[data-wintos][tabindex]");
    if (!view) return false;
    view.focus();
    return true;
}

export function paneShowing(blocks: (Block | undefined)[], url: string): string | undefined {
    return blocks.find((b) => b?.meta?.view === "web" && b.meta.url === url)?.oid;
}

// A PR from the project's notes or the palette opens in the project, beside its terminals; the
// PR view keeps its own tabs. One pane per PR: open again, it is focused.
function openPrHere(url: string): void {
    globalStore.set(mainViewAtom, "terminal");
    const tab = globalStore.get(getWaveObjectAtom<Tab>(makeORef("tab", globalStore.get(atoms.staticTabId))));
    const shown = paneShowing((tab?.blockids ?? []).map((id) => globalStore.get(getWaveObjectAtom<Block>(makeORef("block", id)))), url);
    if (shown) focusBlock(shown);
    else void createBlock({ meta: { view: "web", url } });
}

// ⇧⌘W: asks first when Claude sessions would stop; ⇧⌘W again confirms.
function closeProject(): void {
    const tabId = globalStore.get(atoms.staticTabId);
    if (globalStore.get(overlayAtom) !== "confirm-close" && closeWarning(latestSessions(), tabId)) return toggleOverlay("confirm-close");
    globalStore.set(overlayAtom, "");
    void getApi().closeTab(globalStore.get(atoms.workspace).oid, tabId, false);
}

// ⇧⌘J / ⇧⌘G open a view, and the same key again goes back to the terminals.
export function toggleView(view: MainView): void {
    if (globalStore.get(mainViewAtom) === view) return focusArea("terminal");
    globalStore.set(mainViewAtom, view);
}

export function openPanel(name: string): void {
    const same = globalStore.get(mainViewAtom) === "panel" && globalStore.get(panelNameAtom) === name;
    globalStore.set(panelNameAtom, name);
    if (same) return focusArea("terminal");
    globalStore.set(mainViewAtom, "panel");
}

let registered = false;
export function registerWintosMenu(): void {
    if (registered) return;
    registered = true;
    getApi().onWintosMenu(runAction);
    // Dev builds only: lets wintos/e2e drive menu actions that native menus keep out of reach.
    if (isDev()) (window as unknown as { wintosAction: typeof runAction }).wintosAction = runAction;
}
