import { execFile } from "node:child_process";
import { open, readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { exactPr, matches, prSearchPattern, prUrls, searchPrFilesWithoutRg, type SessionHit } from "./history";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
type CodexHit = SessionHit & { provider: "codex"; codexHome: string };

export function resumedCodex(terminal: { foreground?: { argv?: string[] } }): string | undefined {
    const argv = terminal.foreground?.argv ?? [];
    if (basename(argv[0] ?? "") !== "codex") return;
    const at = argv.indexOf("resume");
    const id = at >= 0 ? argv[at + 1] : undefined;
    return id && UUID.exec(id)?.[0] === id ? id : undefined;
}

async function historyFiles(root: string) {
    try {
        return (await readdir(root, { recursive: true })).filter((f) => f.endsWith(".jsonl")).map((f) => join(root, f));
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw e;
    }
}

async function preview(path: string) {
    const file = await open(path, "r");
    try {
        const stat = await file.stat();
        const size = Math.min(stat.size, 128 * 1024);
        const head = Buffer.alloc(size),
            tail = Buffer.alloc(size);
        await file.read(head, 0, size, 0);
        await file.read(tail, 0, size, Math.max(0, stat.size - size));
        return { text: head.toString() + "\n" + tail.toString(), at: stat.mtimeMs };
    } finally {
        await file.close();
    }
}

export async function codexHistory(root: string, query: string): Promise<CodexHit[]> {
    const files = (
        await Promise.all(["sessions", "archived_sessions"].map((dir) => historyFiles(join(root, dir))))
    ).flat();
    if (!files.length) return [];
    let titles: { id: string; thread_name: string; updated_at: string }[] = [];
    try {
        titles = (await readFile(join(root, "session_index.jsonl"), "utf8"))
            .split("\n")
            .filter(Boolean)
            .flatMap((l) => {
                try {
                    return [JSON.parse(l)];
                } catch {
                    return [];
                }
            });
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const names = new Map(titles.map((t) => [t.id, t]));
    const matching = new Map<string, string[]>();
    if (exactPr(query)) {
        const pattern = prSearchPattern(query);
        const output = await new Promise<string>((resolve, reject) =>
            execFile(
                "rg",
                [
                    "--only-matching",
                    "--ignore-case",
                    "--with-filename",
                    "--no-heading",
                    "--max-count",
                    "1",
                    "--glob",
                    "*.jsonl",
                    "--",
                    pattern,
                    ...["sessions", "archived_sessions"]
                        .map((d) => join(root, d))
                        .filter((d) => files.some((f) => f.startsWith(d + "/"))),
                ],
                { timeout: 10000, maxBuffer: 1024 * 1024 },
                (err, out) => (err && err.code !== 1 ? reject(err) : resolve(out))
            )
        ).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
            return searchPrFilesWithoutRg(
                ["sessions", "archived_sessions"]
                    .map((dir) => join(root, dir))
                    .filter((dir) => files.some((file) => file.startsWith(dir + "/"))),
                query
            );
        });
        for (const line of output.split("\n")) {
            const i = line.indexOf(".jsonl:");
            if (i >= 0) {
                const file = line.slice(0, i + 6);
                matching.set(file, [...(matching.get(file) ?? []), line.slice(i + 7)]);
            }
        }
    }
    const selected = files
        .filter((file) => {
            const id = UUID.exec(basename(file))?.[0];
            return exactPr(query)
                ? matching.has(file)
                : !query ||
                      `${names.get(id ?? "")?.thread_name ?? ""} ${id}`.toLowerCase().includes(query.toLowerCase());
        })
        .slice(-100);
    const hits: CodexHit[] = [];
    for (const path of selected) {
        const data = await preview(path);
        const records = data.text.split("\n").flatMap((line) => {
            try {
                return [JSON.parse(line)];
            } catch {
                return [];
            }
        });
        const meta = records.find((r) => r.type === "session_meta")?.payload;
        if (!meta?.id || !meta.cwd || typeof meta.source === "object") continue;
        const title = names.get(meta.id);
        const hit: CodexHit = {
            id: meta.id,
            name: title?.thread_name ?? basename(meta.cwd),
            source: "transcript",
            provider: "codex",
            codexHome: root,
            configDir: root,
            cwd: meta.cwd,
            prs: [...new Set([...(matching.get(path) ?? []), ...prUrls(data.text)])],
            lastAt: Math.max(Date.parse(title?.updated_at ?? "") || 0, data.at),
            transcriptPath: path,
            live: false,
        };
        if (matches(hit, query)) hits.push(hit);
    }
    return hits;
}
