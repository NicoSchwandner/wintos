// WintOS: runs wintosd (wintos/daemon) beside wavesrv. It uses Electron's own Node through
// ELECTRON_RUN_AS_NODE, so WintOS needs no separate Node install. Unlike wavesrv, wintosd
// dying does not quit the app: the sidebar shows "daemon offline" instead.
import * as child_process from "node:child_process";
import { randomBytes } from "node:crypto";
import { ipcMain, powerMonitor } from "electron";
import * as path from "node:path";
import * as readline from "node:readline";
import { wintosInstance } from "../wintos/instance";
import { getElectronAppUnpackedBasePath } from "./emain-platform";

let proc: child_process.ChildProcess | null = null;
// A fresh secret per launch, shared with the renderer: web pages can reach 127.0.0.1 too.
const token = randomBytes(24).toString("hex");
ipcMain.on("wintos-token", (e) => (e.returnValue = token));
ipcMain.on("wintos-instance", (e) => (e.returnValue = wintosInstance(process.env)));

export function runWintosd(): void {
    const script = path.join(getElectronAppUnpackedBasePath(), "wintos", "wintosd.cjs");
    proc = child_process.spawn(process.execPath, [script], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", WINTOS_TOKEN: token },
        // stdin stays open as a lifeline: when Electron dies, even by crash, the pipe closes
        // and wintosd exits instead of holding the port for the next launch.
        stdio: ["pipe", "pipe", "pipe"],
    });
    for (const stream of [proc.stdout, proc.stderr]) {
        readline.createInterface({ input: stream, terminal: false }).on("line", (l) => console.log(l));
    }
    proc.on("exit", (code) => {
        console.log(`[wintosd] exited with ${code}`);
        proc = null;
    });
    proc.on("error", (e) => console.log(`[wintosd] could not start ${script}: ${e}`));
    reportIdle();
}

// How long the Mac has had no input, for the day's rhythm (wintos/daemon/rhythm): a walk away
// counts as a break whatever window had focus. Only the main process can read it.
let idleTimer: NodeJS.Timeout | undefined;
function reportIdle(): void {
    if (idleTimer) return;
    const { port } = wintosInstance(process.env);
    idleTimer = setInterval(() => {
        const idleMs = powerMonitor.getSystemIdleTime() * 1000;
        fetch(`http://127.0.0.1:${port}/rhythm/idle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idleMs }) }).catch(() => {});
    }, 30_000);
    idleTimer.unref();
}

export function stopWintosd(): void {
    proc?.kill();
}
