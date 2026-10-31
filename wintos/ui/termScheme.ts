import { colord } from "colord";

// xterm draws the pane on a transparent background, so its own answer to a background query is
// black; programs that pick light or dark from it (Claude Code's "auto") need the colour we paint.
export function backgroundReply(bg: string): string {
    const { r, g, b } = colord(bg).toRgb();
    const hex = (n: number) => n.toString(16).padStart(2, "0").repeat(2);
    return `\x1b]11;rgb:${hex(r)}/${hex(g)}/${hex(b)}\x1b\\`;
}

// The colour-scheme report of mode 2031 (1 dark, 2 light): told when the appearance flips, a
// program asks for the background again.
export const schemeReport = (bg: string) => `\x1b[?997;${colord(bg).isDark() ? 1 : 2}n`;
