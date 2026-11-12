import { execFile } from "child_process";
import { existsSync } from "fs";
import { liveSubagents, type Session } from "./reduce";
import { tmuxSocket } from "./tmux";

// A session whose turn is over and that runs nothing is paused: its Claude stops (and with it its
// MCP servers, over a gigabyte a session), its row and pane stay, and opening the pane or a wake
// resumes it (`claude --resume`). On an update, and after it sat idle and unseen this long. One
// still at work keeps running in its tmux through the update: that is what tmux is there for.
export const IDLE_PAUSE_MS = 8 * 3_600_000;

// The sessions that may be paused: in a pane of WintOS's (not the background service's), between
// turns, no subagent running, not being read; with idleMs, also untouched and unseen that long.
export function pausable(sessions: Iterable<Session>, now: number, seen: Map<string, number>, focused: string | undefined, idleMs?: number): Session[] {
    return [...sessions].filter(
        (s) =>
            !!s.blockId && !s.bgId && !s.background && !s.restored && !s.reading && s.state !== "working" && s.state !== "ended" && s.id !== focused && !liveSubagents(s, now) &&
            (idleMs === undefined || (now - s.lastAt >= idleMs && now - (seen.get(s.id) ?? 0) >= idleMs)),
    );
}

type Proc = { pid: number; ppid: number; age: number; command: string };

// `ps -axo pid=,ppid=,etime=,command=`; etime is [[dd-]hh:]mm:ss.
export function parsePs(out: string): Proc[] {
    return out.split("\n").flatMap((l) => {
        const m = /^\s*(\d+)\s+(\d+)\s+(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)\s+(.*)$/.exec(l);
        return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), age: ((Number(m[3] ?? 0) * 24 + Number(m[4] ?? 0)) * 60 + Number(m[5])) * 60 + Number(m[6]), command: m[7] }] : [];
    });
}

// Its own program is Claude: the first word is claude, or a binary under claude/versions/.
const isClaude = (command: string) => /(^|\/)claude$/.test(command.split(/\s/)[0]) || /^\S*claude\/versions\//.test(command);

const SHELL = /(^|\/)-?(zsh|bash|sh|fish)(\s|$)/;
// Its MCP servers start with it; a child that came later, or a shell, is a command it runs (a
// Bash tool, a Monitor, a background job): then it is at work, whatever its turn says.
const STARTUP_S = 120;

// Per pane: the Claude its shell runs, and whether it runs anything besides its MCP servers.
export function paneClaudes(procs: Proc[], panes: Map<string, number>): Map<string, { pid: number; busy: boolean }> {
    const out = new Map<string, { pid: number; busy: boolean }>();
    for (const [blockId, shell] of panes) {
        // Below the shell, not only its child: `claude` may run through a wrapper (`command claude`).
        const below = [shell];
        for (let i = 0; i < below.length && i < 50; i++) for (const p of procs) if (p.ppid === below[i]) below.push(p.pid);
        const claude = procs.find((p) => below.includes(p.pid) && p.pid !== shell && isClaude(p.command));
        if (!claude) continue;
        const kids = procs.filter((p) => p.ppid === claude.pid);
        out.set(blockId, { pid: claude.pid, busy: kids.some((k) => SHELL.test(k.command) || k.age < claude.age - STARTUP_S) });
    }
    return out;
}

const TMUX = ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"];
const run = (cmd: string, args: string[]) => new Promise<string>((done) => execFile(cmd, args, { timeout: 10_000, maxBuffer: 8 << 20 }, (_e, out) => done(String(out ?? ""))));

export async function readPaneClaudes(): Promise<Map<string, { pid: number; busy: boolean }>> {
    if (process.env.VITEST) return new Map();
    const bin = TMUX.find((p) => existsSync(p)) ?? "tmux";
    const panes = new Map<string, number>();
    for (const l of (await run(bin, ["-L", tmuxSocket(), "list-panes", "-a", "-F", "#{session_name} #{pane_pid}"])).split("\n")) {
        const m = /^w-(\S+) (\d+)$/.exec(l.trim());
        if (m) panes.set(m[1], Number(m[2]));
    }
    return paneClaudes(parsePs(await run("/bin/ps", ["-axo", "pid=,ppid=,etime=,command="])), panes);
}
