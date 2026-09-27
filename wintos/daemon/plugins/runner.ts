import { execFile } from "child_process";
import { accessSync, constants, readdirSync, statSync } from "fs";
import { join } from "path";

// A plugin is any executable that prints one JSON document on stdout (the Unix contract the
// spec picked). Core plugins ship with WintOS; Wint's live in ~/.config/wintos/plugins/.
export type Plugin = { name: string; cmd: string[]; env?: Record<string, string>; everyMs: number; timeoutMs?: number };
export type PluginResult = { ok: boolean; at: number; data?: unknown; error?: string };

const DEFAULT_TIMEOUT_MS = 60_000;
const USER_PLUGIN_EVERY_MS = 5 * 60_000;

export class PluginRunner {
    readonly results: Record<string, PluginResult> = {};
    private timers: NodeJS.Timeout[] = [];

    constructor(private plugins: Plugin[], private onResult: () => void) {}

    start(): void {
        for (const p of this.plugins) {
            void this.run(p.name);
            if (p.everyMs > 0) this.timers.push(setInterval(() => void this.run(p.name), p.everyMs));
        }
    }

    stop(): void {
        this.timers.forEach(clearInterval);
    }

    run(name: string): Promise<boolean> {
        const p = this.plugins.find((x) => x.name === name);
        if (!p) return Promise.resolve(false);
        return new Promise((resolve) => {
            execFile(
                p.cmd[0],
                p.cmd.slice(1),
                { env: { ...process.env, ...p.env }, timeout: p.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 },
                (err, stdout, stderr) => {
                    const last = this.results[name]?.data;
                    let result: PluginResult;
                    if (err) result = { ok: false, at: Date.now(), data: last, error: (stderr || err.message).trim().slice(0, 500) };
                    else {
                        try {
                            result = { ok: true, at: Date.now(), data: JSON.parse(stdout) };
                        } catch {
                            result = { ok: false, at: Date.now(), data: last, error: "output was not JSON" };
                        }
                    }
                    this.results[name] = result;
                    this.onResult();
                    resolve(true);
                }
            );
        });
    }
}

export function discoverPlugins(dir: string): Plugin[] {
    let names: string[];
    try {
        names = readdirSync(dir);
    } catch {
        return [];
    }
    return names
        .map((name) => ({ name, path: join(dir, name) }))
        .filter(({ path }) => {
            try {
                accessSync(path, constants.X_OK);
                return statSync(path).isFile();
            } catch {
                return false;
            }
        })
        .map(({ name, path }) => ({ name, cmd: [path], everyMs: USER_PLUGIN_EVERY_MS }));
}
