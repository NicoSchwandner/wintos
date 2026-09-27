import { globalStore } from "@/app/store/jotaiStore";
import { atoms, createBlock, getApi, isDev } from "@/store/global";
import { focusedSession } from "./focus";
import { mainViewAtom, panelNameAtom, type MainView } from "./notes/state";
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

// ⇧⌘N: another Claude session in this project, next to the focused one and in its directory.
function newSession(): void {
    const cwd = focusedSession()?.cwd;
    createBlock({ meta: { view: "term", controller: "shell", "cmd:initscript": newSessionScript(cwd) } });
}

function runAction(action: string): void {
    if (action === "session") return newSession();
    if (action === "notes" || action === "prs") return toggleView(action);
    if (action === "panel") {
        const first = currentState() && pluginPanels(currentState()!)[0];
        return first ? openPanel(first.name) : undefined;
    }
    const b = blockDefFor(action, globalStore.get(atoms.fullConfigAtom)?.widgets);
    if (b) createBlock(b.def, false, b.ephemeral);
}

// ⌘J / ⇧⌘P open a view, and the same key again goes back to the terminals.
export function toggleView(view: MainView): void {
    globalStore.set(mainViewAtom, (v) => (v === view ? "terminal" : view));
}

export function openPanel(name: string): void {
    const same = globalStore.get(mainViewAtom) === "panel" && globalStore.get(panelNameAtom) === name;
    globalStore.set(panelNameAtom, name);
    globalStore.set(mainViewAtom, same ? "terminal" : "panel");
}

let registered = false;
export function registerWintosMenu(): void {
    if (registered) return;
    registered = true;
    getApi().onWintosMenu(runAction);
    // Dev builds only: lets wintos/e2e drive menu actions that native menus keep out of reach.
    if (isDev()) (window as unknown as { wintosAction: typeof runAction }).wintosAction = runAction;
}
