import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { slugify } from "../projects/slug";
import { parseUnits, serializeUnits, type Unit } from "../projects/units";

// An epic: a main todo item that lasts weeks, which sessions are steps of. One folder per epic
// beside the projects, holding epic.md (its front matter) and mine.md, the notes all its sessions
// share. look: the face it shows (ui/epicLook.ts), picked from the id when the file names none.
// lane: sessions in this lane land here when nothing else says where (a review lane → Reviews).
// steps: planned steps no session has taken yet. done: the day it was finished. pinned: one you
// drive, kept in sight at the top of the sidebar.
// agent: the session that is the epic agent, which you talk to about the whole epic.
export type Epic = { id: string; title: string; short?: string; glyph?: string; color?: string; lane?: string; steps: Unit[]; done?: string; pinned?: boolean; agent?: string };
export type EpicFile = Epic & { dir: string; mtime: number; mineMtime: number; body: string };

export const EPIC_TITLE_MAX = 80;
export const SHORT_MAX = 20;

export function parseEpicMd(raw: string): { epic: Epic; body: string } | undefined {
    const m = /^---\n([\s\S]*?)\n?---\n?([\s\S]*)$/.exec(raw.replace(/\r\n/g, "\n"));
    if (!m) return undefined;
    const kv: Record<string, string> = {};
    for (const line of m[1].split("\n")) {
        const i = line.indexOf(":");
        if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    if (!kv.id || !kv.title) return undefined;
    const epic: Epic = { id: kv.id, title: kv.title, steps: kv.steps ? parseUnits(kv.steps) : [] };
    for (const k of ["short", "glyph", "color", "lane", "done", "agent"] as const) if (kv[k]) epic[k] = kv[k];
    if (kv.pinned === "true") epic.pinned = true;
    return { epic, body: m[2] };
}

export function serializeEpicMd(e: Epic, body: string): string {
    const lines = [`id: ${e.id}`, `title: ${e.title}`];
    for (const k of ["short", "glyph", "color", "lane", "done", "agent"] as const) if (e[k]) lines.push(`${k}: ${e[k]}`);
    if (e.pinned) lines.push("pinned: true");
    if (e.steps.length) lines.push(`steps: ${serializeUnits(e.steps)}`);
    return `---\n${lines.join("\n")}\n---\n${body}`;
}

// The same matching as `wintos step`, over ids, titles and short names: exact first, then the
// first that starts with it.
export function findEpic<T extends Epic>(epics: T[], q: string): T | undefined {
    const want = q.trim().toLowerCase();
    const names = (e: Epic) => [e.id, e.title, e.short ?? ""].map((s) => s.toLowerCase());
    return epics.find((e) => names(e).includes(want)) ?? epics.find((e) => names(e).some((n) => n && n.startsWith(want)));
}

const mtimeOf = (file: string) => (existsSync(file) ? statSync(file).mtimeMs : 0);

export class EpicStore {
    private epics: EpicFile[] = [];

    constructor(readonly root: string) {
        mkdirSync(root, { recursive: true });
        this.reload();
    }

    reload(): void {
        this.epics = readdirSync(this.root, { withFileTypes: true })
            .filter((d) => d.isDirectory() && !d.name.startsWith("."))
            .flatMap((d) => this.read(join(this.root, d.name)) ?? []);
    }

    // An unfinished epic comes first; a finished one stays listed for the month's report.
    list(): EpicFile[] {
        return this.epics.map((e) => ({ ...e, mineMtime: mtimeOf(join(e.dir, "mine.md")) }));
    }

    byId(id: string): EpicFile | undefined {
        return this.epics.find((e) => e.id === id);
    }

    create(title: string, extra: Partial<Omit<Epic, "id" | "title" | "steps">> = {}): EpicFile {
        const id = slugify(title, new Set(readdirSync(this.root)));
        const dir = join(this.root, id);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "epic.md"), serializeEpicMd({ id, title, steps: [], ...extra }, ""));
        this.reload();
        return this.byId(id)!;
    }

    // Rewrites the front matter with some keys changed, the body and every other key as they are.
    update(id: string, change: (e: Epic) => Epic): EpicFile | undefined {
        const e = this.byId(id);
        if (!e) return undefined;
        const { dir, mtime: _m, mineMtime: _mm, body, ...epic } = e;
        writeFileSync(join(dir, "epic.md"), serializeEpicMd(change(epic), body));
        this.reload();
        return this.byId(id);
    }

    mine(id: string): { text: string; mtime: number } | undefined {
        const e = this.byId(id);
        if (!e) return undefined;
        const file = join(e.dir, "mine.md");
        return { text: existsSync(file) ? readFileSync(file, "utf8") : "", mtime: mtimeOf(file) };
    }

    // baseMtime: the version the edit started from; a file changed since is not overwritten.
    saveMine(id: string, text: string, baseMtime?: number): "ok" | "no epic" | "conflict" {
        const e = this.byId(id);
        if (!e) return "no epic";
        const file = join(e.dir, "mine.md");
        if (baseMtime !== undefined && mtimeOf(file) !== baseMtime) return "conflict";
        writeFileSync(file, text);
        return "ok";
    }

    private read(dir: string): EpicFile | undefined {
        const file = join(dir, "epic.md");
        if (!existsSync(file)) return undefined;
        const parsed = parseEpicMd(readFileSync(file, "utf8"));
        return parsed && { ...parsed.epic, body: parsed.body, dir, mtime: statSync(file).mtimeMs, mineMtime: mtimeOf(join(dir, "mine.md")) };
    }
}
