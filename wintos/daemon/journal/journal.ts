import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { answersOf, goalsAhead, rank, reflectionOf, withReflection, withTomorrow, type Level } from "./reflection";

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

const ordinal = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th");
export const longDate = (d: Date) =>
    `${d.toLocaleDateString("en-US", { weekday: "long" })}, ${d.toLocaleDateString("en-US", { month: "long" })} ${d.getDate()}${ordinal(d.getDate())} ${d.getFullYear()}`;
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function isoWeek(d: Date): number {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    return Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7);
}

// reflection: the reflection waiting to be written, for the Today card's nudge.
export type Day = { date: string; exists: boolean; mtime: number; focus: string; planned: boolean; yesterday?: { date: string; focus: string; tomorrow: string[] }; reflection?: { date: string; level: Level; title: string } };

// A reflection and what it looks back on, all of it written by you or recorded on the day:
// goals: what the last reflection of this level or higher set; days: a weekly's days, each with its
// focus; earlier: the lower reflections since then, as their answers.
export type ReflectionView = {
    date: string; level: Level; title: string; body: string; mtime: number;
    goals?: { date: string; title: string; items: string[] };
    days: { date: string; focus: string }[];
    earlier: { date: string; level: Level; title: string; answers: string }[];
};

// The nudge shows from this hour on the reflection's day, and stays until you write it. ponytail:
// fixed, a setting if anyone reflects in the morning.
const NUDGE_FROM_HOUR = 14;
// A reflection older than this is let go rather than nudged about: no backlog.
const NUDGE_DAYS = 7;
// How far a look-back reaches when no earlier reflection of its level bounds it.
const REACH_DAYS: Record<Level, number> = { weekly: 7, monthly: 35, quarterly: 100, yearly: 370 };

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

    // The last workday's file: a weekend note (a personal to-do on a Sunday) is not the plan Monday
    // carries on from. ponytail: Saturday and Sunday are fixed, a setting if weekends ever become workdays.
    private previous(before: string): string | undefined {
        return this.files().filter((f) => isoOf(f) < before && !weekend(isoOf(f))).pop();
    }

    private files(): string[] {
        const files: string[] = [];
        for (const y of safeList(this.dir).filter((n) => /^\d{4}$/.test(n)))
            for (const m of safeList(join(this.dir, y)).filter((n) => /^\d{2}$/.test(n)))
                for (const f of safeList(join(this.dir, y, m))) if (/^\d{4}-\d{2}-\d{2}\.md$/.test(f)) files.push(join(this.dir, y, m, f));
        return files.sort();
    }

    private reflections(upTo: string, from = ""): { date: string; file: string; text: string; level: Level; title: string; body: string }[] {
        return this.files()
            .filter((f) => isoOf(f) >= from && isoOf(f) <= upTo)
            .flatMap((file) => {
                const text = readFileSync(file, "utf8");
                const r = reflectionOf(text);
                return r ? [{ date: isoOf(file), file, text, ...r }] : [];
            });
    }

    private templateOf(level: Level): string {
        try {
            return reflectionOf(readFileSync(join(dirname(this.template), `${level}_template.md`), "utf8"))?.body ?? "";
        } catch {
            return "";
        }
    }

    private pending(now: Date): Day["reflection"] {
        const today = isoDay(now);
        // Every state the windows get asks this: only the files that could still nudge are read.
        const from = new Date(now);
        from.setDate(from.getDate() - NUDGE_DAYS);
        const last = this.reflections(today, isoDay(from)).pop();
        if (!last || answersOf(last.body, this.templateOf(last.level))) return undefined;
        if (last.date === today && now.getHours() < NUDGE_FROM_HOUR) return undefined;
        return { date: last.date, level: last.level, title: last.title };
    }

    // date: the reflection's day; without one, the one waiting to be written, else the latest.
    reflection(now: Date, date?: string): ReflectionView | undefined {
        const all = this.reflections(isoDay(now));
        const at = date ?? this.pending(now)?.date ?? all[all.length - 1]?.date;
        const i = all.findIndex((r) => r.date === at);
        if (i < 0) return undefined;
        const r = all[i];
        const before = all.slice(0, i).filter((p) => rank(p.level) >= rank(r.level)).pop();
        const reach = new Date(`${r.date}T12:00:00`);
        reach.setDate(reach.getDate() - REACH_DAYS[r.level]);
        const from = before?.date ?? isoDay(reach);
        const goals = before && goalsAhead(before.text);
        return {
            date: r.date, level: r.level, title: r.title, body: r.body, mtime: statSync(r.file).mtimeMs,
            ...(goals?.length ? { goals: { date: before!.date, title: before!.title, items: goals } } : {}),
            days: r.level === "weekly" ? this.files().filter((f) => isoOf(f) > from && isoOf(f) <= r.date && !weekend(isoOf(f))).map((f) => ({ date: isoOf(f), focus: focusOf(readFileSync(f, "utf8")) })) : [],
            earlier: all.slice(0, i).filter((p) => p.date > from && rank(p.level) < rank(r.level)).reverse().map((p) => ({ date: p.date, level: p.level, title: p.title, answers: answersOf(p.body, this.templateOf(p.level)) })),
        };
    }

    // baseMtime as for the focus: a file changed since the page read it is never overwritten.
    saveReflection(date: string, body: string, baseMtime: number): "ok" | "conflict" | "missing" {
        const file = this.file(new Date(`${date}T12:00:00`));
        if (!existsSync(file) || !reflectionOf(readFileSync(file, "utf8"))) return "missing";
        if (statSync(file).mtimeMs !== baseMtime) return "conflict";
        writeFileSync(file, withReflection(readFileSync(file, "utf8"), body));
        return "ok";
    }

    day(d: Date): Day {
        const file = this.file(d);
        const exists = existsSync(file);
        const text = exists ? readFileSync(file, "utf8") : "";
        const prev = this.previous(isoDay(d));
        const prevText = prev ? readFileSync(prev, "utf8") : "";
        const reflection = this.pending(d);
        return {
            date: isoDay(d),
            exists,
            mtime: exists ? statSync(file).mtimeMs : 0,
            focus: focusOf(text),
            planned: this.planned().includes(isoDay(d)),
            ...(prev ? { yesterday: { date: isoOf(prev), focus: focusOf(prevText), tomorrow: goalsAhead(prevText) } } : {}),
            ...(reflection ? { reflection } : {}),
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

    // The day's wrap-up: these go under its goals for tomorrow, which the next day starts from.
    addTomorrow(d: Date, items: string[]): void {
        const file = this.file(d);
        if (!existsSync(file) && this.create) {
            try {
                this.create();
            } catch {}
        }
        const base = existsSync(file) ? readFileSync(file, "utf8") : readFileSync(this.template, "utf8").replace(/\$date/g, longDate(d)).replace(/\$week/g, String(isoWeek(d)));
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, withTomorrow(base, items));
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

const weekend = (iso: string) => [0, 6].includes(new Date(`${iso}T12:00:00`).getDay());
const isoOf = (file: string) => file.slice(-13, -3);
