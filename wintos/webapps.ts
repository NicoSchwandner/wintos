import { execFile, execFileSync } from "child_process";
import { existsSync, readdirSync } from "fs";
import { join } from "path";

// A link to a site you installed as a Chrome web app (Google Meet, say) opens in that app rather
// than a browser tab. Chrome keeps each app as a small .app shim whose Info.plist names its id
// and start page; the Chrome profile that owns it holds a folder named after the id.
export type WebApp = { id: string; startUrl: string; profile: string };

export function appFor(apps: WebApp[], url: string): WebApp | undefined {
    const host = hostOf(url);
    return host ? apps.find((a) => hostOf(a.startUrl) === host) : undefined;
}

export const launchArgs = (app: WebApp, url: string): string[] => [
    "-na",
    "Google Chrome",
    "--args",
    `--profile-directory=${app.profile}`,
    `--app-id=${app.id}`,
    `--app-launch-url-for-shortcuts-menu-item=${url}`,
];

function hostOf(u: string): string | undefined {
    try {
        const url = new URL(u);
        return url.protocol === "https:" ? url.hostname : undefined;
    } catch {
        return undefined;
    }
}

const ls = (dir: string) => (existsSync(dir) ? readdirSync(dir) : []);

// Read each time a link opens: a handful of shims, and an app installed or removed since counts.
export function installedWebApps(home: string): WebApp[] {
    const shims = join(home, "Applications", "Chrome Apps.localized");
    const chrome = join(home, "Library", "Application Support", "Google", "Chrome");
    const apps: WebApp[] = [];
    for (const name of ls(shims).filter((n) => n.endsWith(".app"))) {
        try {
            const plist = JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", join(shims, name, "Contents", "Info.plist")], { encoding: "utf8" }));
            const id = plist.CrAppModeShortcutID;
            const profile = ls(chrome).find((p) => existsSync(join(chrome, p, "Web Applications", "Manifest Resources", id)));
            if (id && plist.CrAppModeShortcutURL && profile) apps.push({ id, startUrl: plist.CrAppModeShortcutURL, profile });
        } catch {
            // An unreadable shim is skipped; its links open in the browser as before.
        }
    }
    return apps;
}

// true: the link went to its web app; false: none installed, the caller opens it as usual.
export function openInWebApp(url: string, home: string): boolean {
    if (process.platform !== "darwin") return false;
    const app = appFor(installedWebApps(home), url);
    if (!app) return false;
    execFile("open", launchArgs(app, url), (err) => err && console.error(`web app ${app.id} failed for ${url}:`, err));
    return true;
}
