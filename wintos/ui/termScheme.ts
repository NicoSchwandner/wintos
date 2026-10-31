import { colord } from "colord";
import type { Session } from "../daemon/sessions/reduce";

// xterm draws the pane on a transparent background, so its own answer to a background query is
// black; programs that pick light or dark from it (Claude Code's "auto") need the colour we paint.
export function backgroundReply(bg: string): string {
    const { r, g, b } = colord(bg).toRgb();
    const hex = (n: number) => n.toString(16).padStart(2, "0").repeat(2);
    return `\x1b]11;rgb:${hex(r)}/${hex(g)}/${hex(b)}\x1b\\`;
}

export const isDarkBg = (bg: string) => colord(bg).isDark();

// The colour-scheme report of mode 2031 (1 dark, 2 light): told when the appearance flips, a
// program asks for the background again.
export const schemeReport = (dark: boolean) => `\x1b[?997;${dark ? 1 : 2}n`;

// The panes in this tab whose Claude hasn't been told the current appearance. A session that kept
// running through a restart asked for the background only when it started, and no pane recorded
// that it asked; told maps a pane to the appearance it was last told (true: light).
export const schemeNotices = (sessions: Session[], tabId: string, light: boolean, told: Map<string, boolean>): string[] =>
    sessions.filter((s) => s.tabId === tabId && s.state !== "ended" && !s.background && !s.restored && told.get(s.blockId) !== light).map((s) => s.blockId);
