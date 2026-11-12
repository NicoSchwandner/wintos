import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Session } from "../../daemon/sessions/reduce";
import { resumeScriptOf } from "../../daemon/sessions/reduce";
import type { Shelf } from "../../daemon/shelf/shelf";
import { shelvedName } from "../../daemon/shelf/shelf";

export type SessionHit = {
    provider?: "claude" | "codex";
    codexHome?: string;
    terminalPid?: number;
    id: string;
    name: string;
    prs: string[];
    source: "herdr" | "wintos" | "transcript";
    lastAt: number;
    terminal?: string;
    cwd?: string;
    configDir?: string;
    resume?: string;
    live?: boolean;
    transcriptPath?: string;
};
export const prUrls = (text: string): string[] => [
    ...new Set(text.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+\b/g) ?? []),
];
export function readJson<T>(file: string, fallback: T): T {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, "utf8"));
}
const quoted = "'((?:[^']|'\\\\'')*)'";
const resumePattern = new RegExp(`^cd ${quoted} && (?:CLAUDE_CONFIG_DIR=${quoted} )?claude --resume '([\\w-]+)'$`);
export function resumeParts(script: string | undefined, id: string): { cwd: string; configDir?: string } | undefined {
    const m = script && resumePattern.exec(script);
    if (!m || m[3] !== id) return undefined;
    const unquote = (s: string) => s.replace(/'\\''/g, "'");
    return { cwd: unquote(m[1]), ...(m[2] != null ? { configDir: unquote(m[2]) } : {}) };
}
export function waveHistory(root: string): SessionHit[] {
    const hits = new Map<string, SessionHit>();
    for (const s of readJson<Session[]>(join(root, ".sessions.json"), [])) {
        hits.set(s.id, {
            id: s.id,
            name: s.name?.text ?? s.label ?? s.status?.text ?? s.id,
            prs: [...new Set([...(s.prs ?? []), ...(s.touched ?? [])])],
            source: "wintos",
            lastAt: s.lastAt,
            cwd: s.cwd,
            resume: resumeScriptOf(s),
            live: s.state !== "ended" && !s.restored && !s.paused,
        });
    }
    for (const [folder, items] of Object.entries(readJson<Shelf>(join(root, ".shelf.json"), {}))) {
        for (const s of items) {
            const old = hits.get(s.sessionId);
            if (old?.live) continue;
            hits.set(s.sessionId, {
                id: s.sessionId,
                name: shelvedName(s),
                prs: [...new Set([...(old?.prs ?? []), ...(s.prs ?? []), ...(s.touched ?? [])])],
                source: "wintos",
                lastAt: Math.max(s.at, old?.lastAt ?? 0),
                resume: s.script,
                cwd: folder,
                live: false,
            });
        }
    }
    return [...hits.values()];
}
export function exactPr(query: string): boolean {
    return (
        /^#?\d+$/.test(query) ||
        /^(?:[\w.-]+\/)?[\w.-]+#\d+$/.test(query) ||
        /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+\/?$/i.test(query)
    );
}
export function matches(hit: SessionHit, query: string): boolean {
    if (exactPr(query))
        return hit.prs.some((url) => {
            const ref = url.replace(/^https:\/\/github\.com\//i, "").replace("/pull/", "#");
            return /^#?\d+$/.test(query)
                ? ref.split("#")[1] === query.replace(/^#/, "")
                : !query.includes("/")
                  ? ref.split("/").at(-1)?.toLowerCase() === query.toLowerCase()
                  : [url, ref].some((v) => v.toLowerCase() === query.replace(/\/$/, "").toLowerCase());
        });
    return [hit.id, hit.name, hit.cwd, ...hit.prs].join(" ").toLowerCase().includes(query.toLowerCase());
}
export function prSearchPattern(query: string): string {
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const short = /^([\w.-]+)#(\d+)$/.exec(query);
    if (short) return `https://github\\.com/[\\w.-]+/${escape(short[1])}/pull/${short[2]}\\b`;
    const ref = /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(query);
    const url = ref ? `https://github.com/${ref[1]}/${ref[2]}/pull/${ref[3]}` : query;
    const pattern = /^#?\d+$/.test(query)
        ? `https://github\\.com/[\\w.-]+/[\\w.-]+/pull/${query.replace(/^#/, "")}\\b`
        : url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\/$/, "") + "\\b";
    return pattern;
}
export async function transcriptHistory(configDirs: string[], query: string): Promise<SessionHit[]> {
    if (!exactPr(query)) return [];
    const projects = [...new Set(configDirs)].map((dir) => join(dir, "projects")).filter(existsSync);
    if (!projects.length) return [];
    const pattern = prSearchPattern(query);
    const output = await new Promise<string>((resolve, reject) =>
        execFile(
            "rg",
            [
                "--only-matching",
                "--no-heading",
                "--with-filename",
                "--max-count",
                "1",
                "--max-filesize",
                "16M",
                "--glob",
                "*.jsonl",
                "--",
                pattern,
                ...projects,
            ],
            { timeout: 5000, maxBuffer: 256 * 1024 },
            (err, stdout) => {
                if (err && err.code !== 1) reject(new Error(`Transcript search: ${err.message}`));
                else resolve(stdout);
            }
        )
    );
    const hits: SessionHit[] = [];
    for (const line of output.trim().split("\n").slice(0, 100)) {
        const at = line.indexOf(":https://");
        if (at < 0) continue;
        const path = line.slice(0, at),
            pr = line.slice(at + 1);
        const configDir = configDirs.find((dir) => path.startsWith(join(dir, "projects") + "/"));
        const file = await open(path, "r");
        try {
            const stat = await file.stat();
            const head = Buffer.alloc(Math.min(stat.size, 128 * 1024));
            await file.read(head, 0, head.length, 0);
            const tail = Buffer.alloc(Math.min(stat.size, 128 * 1024));
            await file.read(tail, 0, tail.length, Math.max(0, stat.size - tail.length));
            const id = basename(path, ".jsonl");
            const hit: SessionHit = {
                id,
                name: id,
                prs: [pr],
                source: "transcript",
                lastAt: stat.mtimeMs,
                configDir,
                live: false,
                transcriptPath: path,
            };
            let timestamp = 0;
            for (const rowText of (head.toString() + "\n" + tail.toString()).split("\n")) {
                try {
                    const row = JSON.parse(rowText);
                    if (row.cwd) hit.cwd = row.cwd;
                    if (row.customTitle) hit.name = row.customTitle;
                    timestamp = Math.max(timestamp, Date.parse(row.timestamp) || 0);
                } catch {
                    /* Head/tail windows can split JSONL records. */
                }
            }
            if (timestamp) hit.lastAt = timestamp;
            hits.push(hit);
        } finally {
            await file.close();
        }
    }
    return hits;
}
