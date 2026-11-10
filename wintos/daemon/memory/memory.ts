import { execFile } from "child_process";

// What each of WintOS's processes holds, every ten minutes, into the event log: once a process
// grew to tens of gigabytes overnight and nothing said which. phys_footprint (macOS `footprint`),
// as Activity Monitor and the force-quit list count it, compressed memory included.
export type ProcessMemory = { pid: number; role: string; mb: number };

// The Electron main (WintOS's own parent), its children, and theirs (the daemon's plugins, tmux).
export function wintosProcesses(ps: string, main: number): { pid: number; command: string }[] {
    const rows = ps.split("\n").map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l)).filter((m): m is RegExpExecArray => !!m).map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] }));
    const ours = new Set([main]);
    for (let grew = true; grew; ) {
        grew = false;
        for (const r of rows) if (!ours.has(r.pid) && ours.has(r.ppid)) ours.add(r.pid), (grew = true);
    }
    return rows.filter((r) => ours.has(r.pid)).map(({ pid, command }) => ({ pid, command }));
}

export function roleOf(command: string, main: number, pid: number): string {
    if (pid === main) return "main";
    const type = /--type=([a-z-]+)/.exec(command)?.[1];
    if (type) return type;
    if (command.includes("wintosd")) return "daemon";
    if (command.includes("wavesrv")) return "wavesrv";
    if (/plugins\/([\w-]+)\.cjs/.test(command)) return `plugin ${/plugins\/([\w-]+)\.cjs/.exec(command)![1]}`;
    if (command.includes("tmux")) return "tmux";
    return command.split(/[\s/]/).filter(Boolean).slice(-1)[0] ?? "other";
}

// `footprint -p a -p b`: "Electron Helper [89947]: 64-bit    Footprint: 931 MB (…)".
export function parseFootprint(out: string): Map<number, number> {
    const unit: Record<string, number> = { KB: 1 / 1024, MB: 1, GB: 1024 };
    const m = new Map<number, number>();
    for (const [, pid, n, u] of out.matchAll(/\[(\d+)\]: \S+\s+Footprint: ([\d.]+) (KB|MB|GB)/g)) m.set(Number(pid), Math.round(Number(n) * unit[u]));
    return m;
}

const run = (cmd: string, args: string[]) => new Promise<string>((done) => execFile(cmd, args, { timeout: 30_000, maxBuffer: 8 << 20 }, (_e, out) => done(String(out ?? ""))));

export async function sampleMemory(main: number): Promise<ProcessMemory[]> {
    const procs = wintosProcesses(await run("/bin/ps", ["-axo", "pid=,ppid=,command="]), main);
    if (!procs.length) return [];
    const mb = parseFootprint(await run("/usr/bin/footprint", procs.flatMap((p) => ["-p", String(p.pid)])));
    return procs.map((p) => ({ pid: p.pid, role: roleOf(p.command, main, p.pid), mb: mb.get(p.pid) ?? 0 })).sort((a, b) => b.mb - a.mb);
}
