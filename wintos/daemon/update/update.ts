import { execFile, execFileSync, spawn } from "child_process";
import { openSync } from "fs";
import { join } from "path";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

// How far the checkout this WintOS runs from has moved since it started: commits merged or pulled
// in that the running build doesn't have. undefined: not a git checkout (a packaged app).
export function updateWatch(dir: string, onChange: () => void, everyMs = 60_000) {
    let repo: string, started: string;
    try {
        repo = git(dir, "rev-parse", "--show-toplevel");
        started = git(repo, "rev-parse", "HEAD");
    } catch {
        return { behind: () => 0, stop: () => {} };
    }
    let behind = 0;
    const check = () =>
        execFile("git", ["rev-list", "--count", `${started}..HEAD`], { cwd: repo }, (err, out) => {
            const n = err ? behind : Number(String(out).trim()) || 0;
            if (n !== behind) (behind = n), onChange();
        });
    const timer = setInterval(check, everyMs);
    timer.unref?.();
    check();
    return { behind: () => behind, stop: () => clearInterval(timer), repo };
}

// restart.sh rebuilds and restarts this WintOS, the daemon included, so it runs on its own:
// detached, its output in a log. ELECTRON_RUN_AS_NODE is the daemon's own and would turn the
// new Electron into a plain Node.
export function restart(repo: string, dev: boolean, log = "/tmp/wintos-update.log"): void {
    const { ELECTRON_RUN_AS_NODE: _node, ...env } = process.env;
    const out = openSync(log, "w");
    spawn("/bin/bash", [join(repo, "wintos", "restart.sh"), ...(dev ? ["--dev"] : [])], { cwd: repo, env, detached: true, stdio: ["ignore", out, out] }).unref();
}
