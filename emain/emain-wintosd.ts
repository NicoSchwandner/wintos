// WintOS: runs wintosd (wintos/daemon) beside wavesrv. It uses Electron's own Node through
// ELECTRON_RUN_AS_NODE, so WintOS needs no separate Node install. Unlike wavesrv, wintosd
// dying does not quit the app: the sidebar shows "daemon offline" instead.
import * as child_process from "node:child_process";
import * as path from "node:path";
import * as readline from "node:readline";
import { getElectronAppUnpackedBasePath } from "./emain-platform";

let proc: child_process.ChildProcess | null = null;

export function runWintosd(): void {
    const script = path.join(getElectronAppUnpackedBasePath(), "wintos", "wintosd.cjs");
    proc = child_process.spawn(process.execPath, [script], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
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
}

export function stopWintosd(): void {
    proc?.kill();
}
