// WintOS: every browser pane follows one link rule (wintos/links.ts), decided here because a
// navigation can only be cancelled in the main process. New-window links need nothing: Wave's
// browser pane already opens them as a new pane.
import { clipboard, ipcMain, WebContents } from "electron";
import { opensNewPane } from "../wintos/links";

ipcMain.on("wintos-clipboard", (_e, text: string) => typeof text === "string" && clipboard.writeText(text));

export function watchWintosNavigation(wc: WebContents, host: WebContents): void {
    wc.on("will-navigate", (e, url) => {
        if (host.isDestroyed() || !opensNewPane(wc.getURL(), url)) return;
        e.preventDefault();
        host.send("wintos-open-pane", url);
    });
}
