import type { Epic } from "../daemon/epics/epics";

// An epic's face: a glyph and a colour (epics.css). epic.md may name either; what it leaves out
// is picked from the id, so an epic keeps the same face across restarts without anyone choosing.
export const GLYPHS = {
    star: "M12 3.5l2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.4l-5.1 2.7 1-5.6-4.1-4 5.7-.8z",
    route: "M5 4v5a5 5 0 0 0 5 5h9M15 10l4 4-4 4M5 20v-3",
    terminal: "M5 7l5 5-5 5M12 17h7",
    alert: "M12 4l8.5 15h-17zM12 10v4M12 16.8v.2",
    eye: "M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12zM12 9.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z",
    bolt: "M13 3L5 13.5h6L10 21l8-10.5h-6z",
    book: "M5 5.5A2.5 2.5 0 0 1 7.5 3H19v15H7.5A2.5 2.5 0 0 0 5 20.5zM5 20.5A2.5 2.5 0 0 0 7.5 21H19",
    flag: "M5 21V4M5 4h11l-2 4 2 4H5",
    leaf: "M5 19c0-8 5-14 14-14 0 9-6 14-14 14zM5 19l7-7",
    box: "M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8",
    gear: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1",
    chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
    chat: "M4 5h16v11H9l-5 4z",
    shield: "M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z",
} as const;
export const COLORS = ["teal", "rose", "amber", "coral", "violet", "green", "blue", "stone"] as const;
export type Glyph = keyof typeof GLYPHS;
export type EpicColor = (typeof COLORS)[number];
export type Look = { glyph: Glyph; color: EpicColor; d: string; fg: string; bg: string; ring: string };

// The face of a session with no epic yet.
export const NO_EPIC: Look = { glyph: "box", color: "stone", d: GLYPHS.box, fg: "var(--w-epic-stone)", bg: "var(--w-epic-stone-bg)", ring: "var(--w-epic-stone-ring)" };

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const LANE_GLYPH: Record<string, Glyph> = { review: "eye", support: "alert" };

export function lookOf(e: Pick<Epic, "id" | "glyph" | "color" | "lane">): Look {
    const names = Object.keys(GLYPHS) as Glyph[];
    const glyph = e.glyph && e.glyph in GLYPHS ? (e.glyph as Glyph) : (e.lane && LANE_GLYPH[e.lane]) || names[hash(e.id) % names.length];
    const color = (COLORS as readonly string[]).includes(e.color ?? "") ? (e.color as EpicColor) : COLORS[hash(`${e.id}:c`) % COLORS.length];
    return { glyph, color, d: GLYPHS[glyph], fg: `var(--w-epic-${color})`, bg: `var(--w-epic-${color}-bg)`, ring: `var(--w-epic-${color}-ring)` };
}

// What the sidebar and the pane frame call it: the short name, else the title.
export const shortName = (e: Pick<Epic, "title" | "short">) => e.short ?? e.title;

// A session's name under its epic's heading, without the epic it repeats: "Backstage: Auto-book
// fix" under Backstage reads "Auto-book fix".
export function withoutEpic(name: string, e: Pick<Epic, "title" | "short">): string {
    for (const prefix of [shortName(e), e.title]) {
        const m = name.match(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:·–-]\\s*`, "i"));
        if (m && name.length > m[0].length) return name.slice(m[0].length);
    }
    return name;
}

// Its agent is at work now: its face shows a turning ring (EpicAvatar's running).
export const agentWorking = (epic: { agent?: string } | undefined, sessions: { id: string; state: string }[] | undefined) =>
    !!epic?.agent && !!sessions?.some((s) => s.id === epic.agent && s.state === "working");
