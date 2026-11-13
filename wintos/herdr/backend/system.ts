import { execFile } from "node:child_process";
import { cpus as nativeCpus, totalmem as nativeTotalmem, type CpuInfo } from "node:os";

const CacheMs = 5000;
const Unavailable = "System usage unavailable";
const CounterNames = ["user", "nice", "sys", "idle", "irq"] as const;

export type SystemView = { cpu?: number; memory?: { used: number; total: number }; error?: string };
type SystemOptions = { cpus?: () => CpuInfo[]; totalmem?: () => number; vmStat?: () => Promise<string>; now?: () => number };
type CpuSnapshot = { count: number; counters: number[] };

function readVmStat(): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile("/usr/bin/vm_stat", [], { encoding: "utf8", timeout: 2000, maxBuffer: 64 * 1024 }, (error, stdout) => {
            if (error) reject(Error(Unavailable));
            else resolve(stdout);
        });
    });
}

function cpuSnapshot(cores: CpuInfo[]): CpuSnapshot {
    if (cores.length === 0) throw Error(Unavailable);
    const counters = cores.flatMap((core) => CounterNames.map((key) => {
        const value = core.times[key];
        if (!Number.isSafeInteger(value) || value < 0) throw Error(Unavailable);
        return value;
    }));
    return { count: cores.length, counters };
}

function cpuPercent(current: CpuSnapshot, previous?: CpuSnapshot): number | undefined {
    if (!previous || previous.count !== current.count) return;
    const deltas = current.counters.map((value, i) => value - previous.counters[i]);
    if (deltas.some((value) => value < 0)) return;
    const total = deltas.reduce((sum, value) => sum + value, 0);
    if (total <= 0) return;
    const idleIndex = CounterNames.indexOf("idle");
    const idle = deltas.reduce((sum, value, i) => i % CounterNames.length === idleIndex ? sum + value : sum, 0);
    return Math.max(0, Math.min(100, (total - idle) / total * 100));
}

function memoryUsage(text: string, total: number): { used: number; total: number } {
    if (!Number.isSafeInteger(total) || total <= 0) throw Error(Unavailable);
    const header = /^Mach Virtual Memory Statistics:\s*\(page size of (\d+) bytes\)\r?$/m.exec(text);
    const pageSize = Number(header?.[1]);
    if (!Number.isSafeInteger(pageSize) || pageSize <= 0) throw Error(Unavailable);
    const required = ["Anonymous pages", "Pages purgeable", "Pages wired down", "Pages occupied by compressor"];
    const counts = required.map((key) => {
        const lines = text.split(/\r?\n/).filter((line) => line.startsWith(`${key}:`));
        if (lines.length !== 1) throw Error(Unavailable);
        const match = new RegExp(`^${key}:\\s+(\\d+)\\.?\\s*$`).exec(lines[0]);
        const value = match ? Number(match[1]) : NaN;
        if (!Number.isSafeInteger(value)) throw Error(Unavailable);
        return value;
    });
    const [anonymous, purgeable, wired, compressed] = counts;
    // File-backed cache is reclaimable; compressor storage is physical pages, not its uncompressed contents.
    const used = (anonymous - purgeable + wired + compressed) * pageSize;
    if (!Number.isSafeInteger(used)) throw Error(Unavailable);
    return { used: Math.max(0, Math.min(total, used)), total };
}

export function createSystemSampler(options: SystemOptions = {}): { read(): Promise<SystemView> } {
    const cpus = options.cpus ?? nativeCpus;
    const totalmem = options.totalmem ?? nativeTotalmem;
    const vmStat = options.vmStat ?? readVmStat;
    const now = options.now ?? Date.now;
    let previous: CpuSnapshot | undefined;
    let cached: Promise<SystemView> | undefined;
    let expiresAt = 0;
    let inFlight: Promise<SystemView> | undefined;

    async function sample(): Promise<SystemView> {
        const result: SystemView = {};
        try {
            const current = cpuSnapshot(cpus());
            const cpu = cpuPercent(current, previous);
            previous = current;
            if (cpu != null) result.cpu = cpu;
        } catch {
            previous = undefined;
            result.error = Unavailable;
        }
        try {
            const total = totalmem();
            result.memory = memoryUsage(await vmStat(), total);
        } catch {
            result.error = Unavailable;
        }
        return result;
    }

    return {
        read() {
            if (inFlight) return inFlight;
            if (cached && now() < expiresAt) return cached;
            inFlight = Promise.resolve().then(sample).then((result) => {
                expiresAt = now() + CacheMs;
                inFlight = undefined;
                return result;
            });
            cached = inFlight;
            return inFlight;
        },
    };
}
