import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { lineDiff } from "./diff";
import { parseProjectMd, ProjectMeta, serializeProjectMd } from "./parse";
import { slugify } from "./slug";

export type Project = Partial<ProjectMeta> & { dir: string; mtime: number; mineMtime?: number; error?: string; body?: string };

const EMPTY_MINE = "mine.md is empty";

export class ProjectStore {
    private projects: Project[] = [];
    // Keyed by session: each Claude session in a project must see a mine.md change once.
    private lastMine = new Map<string, string>();
    // Which tab each folder belongs to. The daemon owns this, not the file: a session that
    // rewrites project.md from its body alone invents an id, and the notes lose their tab.
    // Kept beside the folders (a file there is not a project) so it survives restarts.
    private bindings: Record<string, string>;
    private readonly bindingsFile: string;

    constructor(readonly root: string) {
        mkdirSync(root, { recursive: true });
        this.bindingsFile = join(root, ".bindings.json");
        try {
            this.bindings = JSON.parse(readFileSync(this.bindingsFile, "utf8"));
        } catch {
            this.bindings = {};
        }
        this.reload();
    }

    private bind(dir: string, id: string): void {
        if (this.bindings[basename(dir)] === id) return;
        this.bindings[basename(dir)] = id;
        writeFileSync(this.bindingsFile, JSON.stringify(this.bindings));
    }

    reload(): void {
        this.projects = readdirSync(this.root, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => this.read(join(this.root, d.name)));
    }

    list(): Project[] {
        return this.projects;
    }

    byTab(tabId: string): Project | undefined {
        return this.projects.find((p) => p.id === tabId);
    }

    setTitle(tabId: string, title: string, opts: { manual: boolean }): Project {
        const existing = this.byTab(tabId);
        if (existing?.error || (existing?.titleLocked && !opts.manual)) return existing!;
        const dir = existing?.dir ?? join(this.root, slugify(title, new Set(readdirSync(this.root))));
        mkdirSync(dir, { recursive: true });
        this.bind(dir, tabId);
        const meta: ProjectMeta = {
            id: tabId,
            titleLocked: opts.manual || !!existing?.titleLocked,
            pr: existing?.pr ?? [],
            title,
            ...(existing?.next ? { next: existing.next } : {}),
        };
        writeFileSync(join(dir, "project.md"), serializeProjectMd(meta, existing?.body ?? ""));
        this.reload();
        return this.byTab(tabId)!;
    }

    mineDiff(tabId: string, sessionId: string): { text: string; diff?: string } {
        const dir = this.byTab(tabId)?.dir;
        const file = dir && join(dir, "mine.md");
        const text = file && existsSync(file) ? readFileSync(file, "utf8") : "";
        if (!text.trim()) return { text: EMPTY_MINE };
        const key = `${tabId}\u0000${sessionId}`;
        const before = this.lastMine.get(key);
        this.lastMine.set(key, text);
        return before === undefined || before === text ? { text } : { text, diff: lineDiff(before, text) };
    }

    notes(tabId: string): { dir: string; projectMd: string | null; mine: string; mineMtime: number } | undefined {
        const p = this.byTab(tabId);
        if (!p) return undefined;
        const mineFile = join(p.dir, "mine.md");
        return { dir: p.dir, projectMd: p.error ? null : (p.body ?? ""), mine: existsSync(mineFile) ? readFileSync(mineFile, "utf8") : "", mineMtime: mtimeOf(mineFile) };
    }

    // The only file WintOS writes on the developer's behalf; always inside the project folder.
    // baseMtime is the version the edit started from: if the file changed since (the developer's
    // own editor), the save is refused rather than overwriting that edit.
    saveMine(tabId: string, text: string, baseMtime?: number): "ok" | "no project" | "conflict" {
        const p = this.byTab(tabId);
        if (!p) return "no project";
        const file = join(p.dir, "mine.md");
        if (baseMtime !== undefined && mtimeOf(file) !== baseMtime) return "conflict";
        writeFileSync(file, text);
        return "ok";
    }

    private read(dir: string): Project {
        const file = join(dir, "project.md");
        if (!existsSync(file)) return { dir, mtime: 0, error: "no project.md" };
        const mineMtime = mtimeOf(join(dir, "mine.md"));
        const raw = readFileSync(file, "utf8");
        const parsed = parseProjectMd(raw);
        const mtime = statSync(file).mtimeMs;
        const bound = this.bindings[basename(dir)];
        if (!("error" in parsed)) {
            if (!bound) this.bind(dir, parsed.meta.id);
            else if (parsed.meta.id !== bound) writeFileSync(file, raw.replace(/^id:.*$/m, `id: ${bound}`));
            return { ...parsed.meta, id: bound ?? parsed.meta.id, body: parsed.body, dir, mtime, mineMtime };
        }
        const id = bound ?? /^id:[ \t]*(\S+)/m.exec(raw)?.[1];
        return { ...(id ? { id } : {}), dir, mtime, mineMtime, error: parsed.error };
    }
}

const mtimeOf = (file: string) => (existsSync(file) ? statSync(file).mtimeMs : 0);
