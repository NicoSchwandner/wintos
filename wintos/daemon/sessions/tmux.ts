import { execFileSync } from "child_process";
import { existsSync } from "fs";

// WintOS runs each pane's shell in a tmux session named after the pane (pkg/wintostmux): a pane
// whose session still runs kept its Claude through a WintOS restart.
export const tmuxSocket = (instance = process.env.WINTOS_INSTANCE) => (instance ? `wintos-${instance.replace(/[^A-Za-z0-9_-]/g, "")}` : "wintos");

const TMUX = ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"];

// The panes whose tmux session runs now; none when there is no tmux, or no server yet.
export function tmuxPanes(): Set<string> {
    // Unit tests never read the developer's own tmux server.
    if (process.env.VITEST) return new Set();
    const bin = TMUX.find((p) => existsSync(p)) ?? "tmux";
    try {
        const out = execFileSync(bin, ["-L", tmuxSocket(), "list-sessions", "-F", "#{session_name}"], { encoding: "utf8", timeout: 3_000, stdio: ["ignore", "pipe", "ignore"] });
        return new Set(out.split("\n").filter((n) => n.startsWith("w-")).map((n) => n.slice(2)));
    } catch {
        return new Set();
    }
}
