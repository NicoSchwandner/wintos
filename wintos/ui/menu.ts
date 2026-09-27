import { globalStore } from "@/app/store/jotaiStore";
import { atoms, createBlock, getApi } from "@/store/global";

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

let registered = false;
export function registerWintosMenu(): void {
    if (registered) return;
    registered = true;
    getApi().onWintosMenu((action) => {
        const b = blockDefFor(action, globalStore.get(atoms.fullConfigAtom)?.widgets);
        if (b) createBlock(b.def, false, b.ephemeral);
    });
}
