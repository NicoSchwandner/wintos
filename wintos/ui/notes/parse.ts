// The four sections of project.md the design renders (spec §5), parsed from the markdown
// conventions the prompt injection asks Claude to write. Unknown sections are kept.
export type Decision = { date?: string; text: string };
export type BuiltItem = { state?: "done" | "partial" | "todo"; text: string };
export type Question = { text: string; blocking: boolean };
export type Notes = { goal?: string; decisions: Decision[]; built: BuiltItem[]; questions: Question[]; other: { heading: string; text: string }[] };

const BUILT_STATE = { x: "done", "~": "partial", " ": "todo" } as const;

export function parseNotes(md: string): Notes {
    const notes: Notes = { decisions: [], built: [], questions: [], other: [] };
    for (const { heading, lines } of sections(md.replace(/\r\n/g, "\n"))) {
        const bullets = lines.filter((l) => /^\s*[-*] /.test(l)).map((l) => l.replace(/^\s*[-*] /, "").trim());
        const text = lines.join("\n").trim();
        switch (heading.toLowerCase()) {
            case "goal":
                if (text) notes.goal = text.split(/\n\s*\n/)[0].trim();
                break;
            case "decisions":
                notes.decisions = bullets.map((b) => {
                    const m = /^(\d{1,2} [A-Za-z]{3}|\d{4}-\d{2}-\d{2})\s*[—:–-]\s*(.*)$/.exec(b);
                    return m ? { date: m[1], text: m[2] } : { text: b };
                });
                break;
            case "built":
                notes.built = bullets.map((b) => {
                    const m = /^\[([x~ ])\]\s*(.*)$/i.exec(b);
                    return m ? { state: BUILT_STATE[m[1].toLowerCase() as keyof typeof BUILT_STATE], text: m[2] } : { text: b };
                });
                break;
            case "open questions":
                notes.questions = bullets.map((b) => ({ text: b.replace(/\s*\(blocking\)\s*$/i, ""), blocking: /\(blocking\)\s*$/i.test(b) }));
                break;
            default:
                if (text) notes.other.push({ heading, text });
        }
    }
    return notes;
}

function sections(md: string): { heading: string; lines: string[] }[] {
    const out: { heading: string; lines: string[] }[] = [{ heading: "", lines: [] }];
    for (const line of md.split("\n")) {
        const h = /^##\s+(.*)$/.exec(line);
        if (h) out.push({ heading: h[1].trim(), lines: [] });
        else out[out.length - 1].lines.push(line);
    }
    return out;
}

export function spans(text: string): { text: string; code?: boolean }[] {
    return text
        .split(/(`[^`]+`)/)
        .filter(Boolean)
        .map((s) => (s.startsWith("`") && s.endsWith("`") ? { text: s.slice(1, -1), code: true } : { text: s }));
}
