// Markdown task lines (`- [ ] x`, `- [x] x`, project.md's `- [~] x`), shared by both notes files.
export type CheckState = "todo" | "partial" | "done";
const TASK = /^(\s*[-*] \[)([ xX~])(\]\s+)(.*)$/;
const STATE = { " ": "todo", x: "done", X: "done", "~": "partial" } as const;

export function checkbox(line: string): { state: CheckState; text: string } | undefined {
    const m = TASK.exec(line);
    return m ? { state: STATE[m[2] as keyof typeof STATE], text: m[4] } : undefined;
}

// Ticking from mine.md's view: flips one line, every other byte of the file stays as it was.
export function toggleCheckbox(md: string, lineIndex: number): string {
    const lines = md.split("\n");
    const m = TASK.exec(lines[lineIndex] ?? "");
    if (!m) return md;
    const ticked = m[2] === "x" || m[2] === "X";
    lines[lineIndex] = `${m[1]}${ticked ? " " : "x"}${m[3]}${m[4]}`;
    return lines.join("\n");
}
