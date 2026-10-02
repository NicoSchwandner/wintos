import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";

// A daily journal: one markdown file a day under <dir>/YYYY/MM/YYYY-MM-DD.md, made from the
// daily template. WintOS reads and writes only the "Today's focus" section; the rest of the file
// (handled tasks, project reporting, reflection) stays the developer's own.
const FOCUS = /^## Today's focus.*$/m;
const PLACEHOLDER = /^\s*-\s*(\[ \]\s*)?\.\.\.\s*$/;

const section = (md: string): { start: number; end: number } | undefined => {
    const h = FOCUS.exec(md);
    if (!h) return undefined;
    const start = h.index + h[0].length;
    const next = /^## /m.exec(md.slice(start));
    return { start, end: next ? start + next.index : md.length };
};

export function focusOf(md: string): string {
    const s = section(md);
    if (!s) return "";
    return md.slice(s.start, s.end).split("\n").filter((l) => !PLACEHOLDER.test(l)).join("\n").trim();
}

// An empty focus keeps the template's placeholder, so the file still reads as the template made it.
export function withFocus(md: string, text: string): string {
    const s = section(md);
    const body = `\n\n${text.trim() || "- [ ] ..."}\n\n`;
    if (!s) return `${md.trimEnd()}\n\n## Today's focus (1-3 items)${body}`;
    return md.slice(0, s.start) + body + md.slice(s.end);
}

export function tomorrowGoals(md: string): string[] {
    const lines = md.split("\n");
    const at = lines.findIndex((l) => l.includes("**Goals and Tasks for tomorrow**"));
    if (at < 0) return [];
    const out: string[] = [];
    for (const l of lines.slice(at + 1)) {
        if (!/^\s+-/.test(l)) break;
        if (!PLACEHOLDER.test(l)) out.push(l.trim());
    }
    return out;
}

const ordinal = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th");
export const longDate = (d: Date) =>
    `${d.toLocaleDateString("en-US", { weekday: "long" })}, ${d.toLocaleDateString("en-US", { month: "long" })} ${d.getDate()}${ordinal(d.getDate())} ${d.getFullYear()}`;
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function isoWeek(d: Date): number {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    return Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7);
}

export type Day = { date: string; exists: boolean; mtime: number; focus: string; planned: boolean; yesterday?: { date: string; focus: string; tomorrow: string[] } };

export class Journal {
    // plannedFile: which days were planned (⌘⏎ on the Today page); kept by WintOS, not in the journal.
    // create: how the journal makes a missing day itself (its own tool knows the weekly and monthly
    // sections); without it, or when it makes nothing, the day comes from the template.
    constructor(readonly dir: string, readonly template: string, readonly plannedFile = join(dir, ".wintos-planned.json"), readonly create?: () => void) {}

    private file(d: Date): string {
        const iso = isoDay(d);
        return join(this.dir, iso.slice(0, 4), iso.slice(5, 7), `${iso}.md`);
    }

    private planned(): string[] {
        try {
            return JSON.parse(readFileSync(this.plannedFile, "utf8"));
        } catch {
            return [];
        }
    }

    private previous(before: string): string | undefined {
        const files: string[] = [];
        for (const y of safeList(this.dir).filter((n) => /^\d{4}$/.test(n)))
            for (const m of safeList(join(this.dir, y)).filter((n) => /^\d{2}$/.test(n)))
                for (const f of safeList(join(this.dir, y, m))) if (/^\d{4}-\d{2}-\d{2}\.md$/.test(f) && f.slice(0, 10) < before) files.push(join(this.dir, y, m, f));
        return files.sort().pop();
    }

    day(d: Date): Day {
        const file = this.file(d);
        const exists = existsSync(file);
        const text = exists ? readFileSync(file, "utf8") : "";
        const prev = this.previous(isoDay(d));
        const prevText = prev ? readFileSync(prev, "utf8") : "";
        return {
            date: isoDay(d),
            exists,
            mtime: exists ? statSync(file).mtimeMs : 0,
            focus: focusOf(text),
            planned: this.planned().includes(isoDay(d)),
            ...(prev ? { yesterday: { date: prev.slice(-13, -3), focus: focusOf(prevText), tomorrow: tomorrowGoals(prevText) } } : {}),
        };
    }

    // baseMtime: the version the edit started from; a file changed since (Obsidian, an editor) is
    // never overwritten. A missing day is made from the template first.
    saveFocus(d: Date, text: string, baseMtime?: number): "ok" | "conflict" {
        const file = this.file(d);
        if (baseMtime !== undefined && (existsSync(file) ? statSync(file).mtimeMs : 0) !== baseMtime) return "conflict";
        if (!existsSync(file) && this.create) {
            try {
                this.create();
            } catch {} // falls back to the template below
        }
        const exists = existsSync(file);
        const base = exists ? readFileSync(file, "utf8") : readFileSync(this.template, "utf8").replace(/\$date/g, longDate(d)).replace(/\$week/g, String(isoWeek(d)));
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, withFocus(base, text));
        return "ok";
    }

    markPlanned(d: Date): void {
        const days = [...new Set([...this.planned(), isoDay(d)])].sort().slice(-60);
        writeFileSync(this.plannedFile, JSON.stringify(days));
    }
}

const safeList = (dir: string) => {
    try {
        return readdirSync(dir);
    } catch {
        return [];
    }
};
