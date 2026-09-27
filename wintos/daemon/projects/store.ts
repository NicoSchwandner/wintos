import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { lineDiff } from "./diff";
import { parseProjectMd, ProjectMeta, serializeProjectMd } from "./parse";
import { slugify } from "./slug";

export type Project = Partial<ProjectMeta> & { dir: string; mtime: number; error?: string; body?: string };

const EMPTY_MINE = "mine.md is empty";

export class ProjectStore {
    private projects: Project[] = [];
    // Keyed by session: each Claude session in a project must see a mine.md change once.
    private lastMine = new Map<string, string>();
    // The last id seen per folder, so a note Claude broke still belongs to its tab.
    private idByDir = new Map<string, string>();

    constructor(readonly root: string) {
        mkdirSync(root, { recursive: true });
        this.reload();
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

    notes(tabId: string): { dir: string; projectMd: string | null; mine: string } | undefined {
        const p = this.byTab(tabId);
        if (!p) return undefined;
        const mineFile = join(p.dir, "mine.md");
        return { dir: p.dir, projectMd: p.error ? null : (p.body ?? ""), mine: existsSync(mineFile) ? readFileSync(mineFile, "utf8") : "" };
    }

    // The only file WintOS writes on the developer's behalf; always inside the project folder.
    saveMine(tabId: string, text: string): boolean {
        const p = this.byTab(tabId);
        if (!p) return false;
        writeFileSync(join(p.dir, "mine.md"), text);
        return true;
    }

    private read(dir: string): Project {
        const file = join(dir, "project.md");
        if (!existsSync(file)) return { dir, mtime: 0, error: "no project.md" };
        const raw = readFileSync(file, "utf8");
        const parsed = parseProjectMd(raw);
        const mtime = statSync(file).mtimeMs;
        if (!("error" in parsed)) {
            this.idByDir.set(dir, parsed.meta.id);
            return { ...parsed.meta, body: parsed.body, dir, mtime };
        }
        const id = /^id:[ \t]*(\S+)/m.exec(raw)?.[1] ?? this.idByDir.get(dir);
        return { ...(id ? { id } : {}), dir, mtime, error: parsed.error };
    }
}
