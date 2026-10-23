// List editing in the notes' editor (mine.md, today's focus): ⏎ continues a list, Tab and ⇧Tab
// indent it, ⌘L ticks the line's box. Pure: text and caret in, text and caret out; null means
// "not in a list here, let the field do its default".

const ITEM = /^(\s*)(?:([-*+]) \[([ xX~])\] |([-*+]) |(\d+)\. )(.*)$/;

const lineAt = (text: string, caret: number) => {
    const start = text.lastIndexOf("\n", caret - 1) + 1;
    const nl = text.indexOf("\n", caret);
    const end = nl < 0 ? text.length : nl;
    return { start, end, line: text.slice(start, end) };
};

export function continueList(text: string, caret: number): { text: string; caret: number } | null {
    const { start, end, line } = lineAt(text, caret);
    const m = ITEM.exec(line);
    if (!m) return null;
    const [, indent, boxBullet, , bullet, num, rest] = m;
    // An empty item ends the list, as in any editor: its marker goes and no new line comes.
    if (!rest.trim() && caret === end) return { text: text.slice(0, start) + text.slice(end), caret: start };
    const marker = boxBullet ? `${indent}${boxBullet} [ ] ` : bullet ? `${indent}${bullet} ` : `${indent}${Number(num) + 1}. `;
    const insert = `\n${marker}`;
    return { text: text.slice(0, caret) + insert + text.slice(caret), caret: caret + insert.length };
}

export function indentLines(text: string, selStart: number, selEnd: number, out: boolean): { text: string; start: number; end: number } | null {
    const first = text.lastIndexOf("\n", selStart - 1) + 1;
    const lines = text.split("\n");
    let pos = 0;
    let firstDelta = 0;
    let total = 0;
    let touched = false;
    const next = lines.map((l) => {
        const lineStart = pos;
        pos += l.length + 1;
        if (lineStart + l.length < first || lineStart > selEnd || !ITEM.test(l)) return l;
        const delta = out ? -Math.min(2, l.length - l.trimStart().length) : 2;
        if (!delta) return l;
        touched = true;
        if (lineStart === first) firstDelta = delta;
        total += delta;
        return delta > 0 ? `  ${l}` : l.slice(-delta);
    });
    if (!touched) return null;
    return { text: next.join("\n"), start: Math.max(first, selStart + firstDelta), end: selEnd + total };
}

export function toggleBox(text: string, caret: number): { text: string; caret: number } | null {
    const { start, line } = lineAt(text, caret);
    const m = /^(\s*[-*+] \[)([ xX~])(\])/.exec(line);
    if (!m) return null;
    const at = start + m[1].length;
    return { text: text.slice(0, at) + (m[2] === " " ? "x" : " ") + text.slice(at + 1), caret };
}
