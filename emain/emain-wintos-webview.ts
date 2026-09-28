// WintOS: webviews inside WintOS views (the PR browser) open links as tabs of that view. The
// renderer registers each such webview; navigation is decided here, the only place it can be
// cancelled. Wave's own web blocks are untouched.
import { clipboard, ipcMain, WebContents } from "electron";

const tabbed = new Set<number>();
ipcMain.on("wintos-clipboard", (_e, text: string) => typeof text === "string" && clipboard.writeText(text));
ipcMain.on("wintos-register-webview", (_e, webContentsId: number) => void tabbed.add(webContentsId));

const origin = (url: string) => {
    try {
        return new URL(url).origin;
    } catch {
        return "";
    }
};

// Called from Wave's window-open handler: a new window (⌘-click, target=_blank) becomes a tab.
export function wintosOpenTab(wc: WebContents, host: WebContents, url: string): boolean {
    if (!tabbed.has(wc.id)) return false;
    host.send("wintos-open-tab", url);
    return true;
}

// A click that leaves the page's site opens a tab too; same-site navigation stays in place.
// Checked per event: the webview attaches before the renderer can register it.
export function watchWintosNavigation(wc: WebContents, host: WebContents): void {
    wc.on("will-navigate", (e, url) => {
        if (!tabbed.has(wc.id) || origin(url) === origin(wc.getURL()) || host.isDestroyed()) return;
        e.preventDefault();
        host.send("wintos-open-tab", url);
    });
    wc.on("destroyed", () => tabbed.delete(wc.id));
}
