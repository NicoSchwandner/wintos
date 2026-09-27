import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { lineDiff } from "./diff";
import { parseProjectMd, ProjectMeta, serializeProjectMd } from "./parse";
import { slugify } from "./slug";

export type Project = Partial<ProjectMeta> & { dir: string; mtime: number; error?: string; body?: string };

const EMPTY_MINE = "mine.md is empty";

export class ProjectStore {
    private projects: Project[] = [];
    private lastMine = new Map<string, string>();

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
        if (existing?.titleLocked && !opts.manual) return existing;
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

    mineDiff(tabId: string): { text: string; diff?: string } {
        const dir = this.byTab(tabId)?.dir;
        const file = dir && join(dir, "mine.md");
        const text = file && existsSync(file) ? readFileSync(file, "utf8") : "";
        if (!text.trim()) return { text: EMPTY_MINE };
        const before = this.lastMine.get(tabId);
        this.lastMine.set(tabId, text);
        return before === undefined || before === text ? { text } : { text, diff: lineDiff(before, text) };
    }

    private read(dir: string): Project {
        const file = join(dir, "project.md");
        if (!existsSync(file)) return { dir, mtime: 0, error: "no project.md" };
        const parsed = parseProjectMd(readFileSync(file, "utf8"));
        const mtime = statSync(file).mtimeMs;
        return "error" in parsed ? { dir, mtime, error: parsed.error } : { ...parsed.meta, body: parsed.body, dir, mtime };
    }
}
