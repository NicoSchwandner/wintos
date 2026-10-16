import { spawn } from "child_process";
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { PR } from "../prs/group";
import { conflictJobs, fixKey, fixPrompt, type FixJob } from "./plan";

// One line per run in runs.jsonl, its full output (stream-json) in logs/<id>.log: what to read
// when a fix went wrong. typed: written into the owning session's pane, which runs it.
export type FixRun = { id: string; kind: FixJob["kind"]; url: string; head?: string; route: FixJob["route"]["kind"]; sessionId?: string; at: number; endedAt?: number; exit?: number | null; result?: string; log?: string };
export type FixerState = { conflicts: boolean; runs: FixRun[]; queued: string[] };

const DEFAULT_CMD = "claude -p --permission-mode auto --output-format stream-json --verbose";
const TIMEOUT_MS = 30 * 60_000;
const SHOWN_RUNS = 50;
const shq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

export class Fixer {
    private readonly dir: string;
    private settings: { conflicts: boolean };
    private tried: Set<string>;
    private runs: FixRun[] = [];
    private queue: { job: FixJob; run: FixRun }[] = [];
    private busy = false;

    constructor(root: string, private onChange: () => void, private cmd = DEFAULT_CMD, private cwd = homedir()) {
        this.dir = join(root, ".fixer");
        mkdirSync(join(this.dir, "logs"), { recursive: true });
        this.settings = { conflicts: true, ...this.read("settings.json", {}) };
        this.tried = new Set(this.read<string[]>("tried.json", []));
        const lines = existsSync(join(this.dir, "runs.jsonl")) ? readFileSync(join(this.dir, "runs.jsonl"), "utf8").trim().split("\n").filter(Boolean) : [];
        const last = new Map<string, FixRun>();
        for (const l of lines.slice(-SHOWN_RUNS * 3)) {
            try {
                const r = JSON.parse(l) as FixRun;
                last.set(r.id, { ...last.get(r.id), ...r });
            } catch {}
        }
        // A run cut off by a restart never ended: it says so rather than looking forever busy.
        this.runs = [...last.values()].map((r) => (r.endedAt || r.route === "pane" ? r : { ...r, endedAt: r.at, exit: null, result: "cut off by a WintOS restart" })).sort((a, b) => b.at - a.at).slice(0, SHOWN_RUNS);
    }

    state(): FixerState {
        return { conflicts: this.settings.conflicts, runs: this.runs, queued: this.queue.map((q) => q.run.id) };
    }

    setConflicts(on: boolean): void {
        this.settings = { ...this.settings, conflicts: on };
        writeFileSync(join(this.dir, "settings.json"), JSON.stringify(this.settings));
        this.onChange();
    }

    // Every PR refresh: the conflicts to resolve, when that is on.
    consider(prs: PR[], me: string): void {
        if (this.settings.conflicts) for (const job of conflictJobs(prs, me, this.tried)) this.start(job);
    }

    // A job's run, recorded before anything happens. A pane run is the caller's to type.
    start(job: FixJob): FixRun {
        this.tried.add(fixKey(job.kind, job.pr));
        writeFileSync(join(this.dir, "tried.json"), JSON.stringify([...this.tried]));
        const at = Date.now();
        const id = `${new Date(at).toISOString().replace(/[:.]/g, "-")}-${job.kind}-${job.pr.repo.split("/")[1]}-${job.pr.number}`;
        const sessionId = job.route.kind === "fresh" ? undefined : job.route.sessionId;
        const run: FixRun = { id, kind: job.kind, url: job.pr.url, head: job.pr.head, route: job.route.kind, ...(sessionId ? { sessionId } : {}), at };
        this.record(run);
        if (job.route.kind !== "pane") {
            this.queue.push({ job, run });
            void this.next();
        }
        this.onChange();
        return run;
    }

    // ponytail: one run at a time; a pool if the queue backs up.
    private async next(): Promise<void> {
        if (this.busy) return;
        const item = this.queue.shift();
        if (!item) return;
        this.busy = true;
        this.onChange();
        try {
            await this.exec(item.job, item.run);
        } finally {
            this.busy = false;
            void this.next();
        }
    }

    private exec(job: FixJob, run: FixRun): Promise<void> {
        const log = join(this.dir, "logs", `${run.id}.log`);
        const line = commandLine(job, this.cmd, this.cwd);
        const out = createWriteStream(log);
        out.write(`# ${line}\n`);
        let result = "";
        return new Promise((resolve) => {
            const child = spawn("/bin/sh", ["-c", line], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, WAVETERM_BLOCKID: "", WAVETERM_TABID: "" } });
            const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
            child.stdout.on("data", (d: Buffer) => {
                out.write(d);
                for (const l of d.toString().split("\n")) {
                    try {
                        const ev = JSON.parse(l) as { type?: string; result?: string };
                        if (ev.type === "result" && typeof ev.result === "string") result = ev.result;
                    } catch {}
                }
            });
            child.stderr.on("data", (d: Buffer) => out.write(d));
            child.on("close", (exit) => {
                clearTimeout(timer);
                out.end();
                this.record({ ...run, endedAt: Date.now(), exit, result: result.trim().split("\n").pop()?.slice(0, 300), log });
                this.onChange();
                resolve();
            });
        });
    }

    private record(run: FixRun): void {
        appendFileSync(join(this.dir, "runs.jsonl"), JSON.stringify(run) + "\n");
        this.runs = [run, ...this.runs.filter((r) => r.id !== run.id)].slice(0, SHOWN_RUNS);
    }

    private read<T>(file: string, fallback: T): T {
        try {
            return JSON.parse(readFileSync(join(this.dir, file), "utf8")) as T;
        } catch {
            return fallback;
        }
    }
}

// A resumed session runs in its own directory and account, as its shelf command says.
export function commandLine(job: FixJob, cmd: string, cwd: string): string {
    const prompt = shq(fixPrompt(job));
    if (job.route.kind === "resume") return job.route.script.replace(/claude --resume ('[\w-]+')$/, `${cmd} --resume $1 ${prompt}`);
    return `cd ${shq(cwd)} && ${cmd} ${prompt}`;
}
