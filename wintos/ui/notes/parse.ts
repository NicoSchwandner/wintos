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

export type Span = { text: string; code?: boolean; url?: string };

// A markdown link, or a bare url up to the sentence's closing punctuation.
const LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>()\[\]]*[^\s<>()\[\].,;:!?'"])/g;

// A bare url reads as host and path; the scheme and www. say nothing.
const shortUrl = (url: string) => {
    const s = url.replace(/^https?:\/\/(www\.)?/, "");
    return s.length > 47 ? `${s.slice(0, 47)}…` : s;
};

export function spans(text: string): Span[] {
    return text
        .split(/(`[^`]+`)/)
        .filter(Boolean)
        .flatMap((s): Span[] => {
            if (s.startsWith("`") && s.endsWith("`")) return [{ text: s.slice(1, -1), code: true }];
            const out: Span[] = [];
            let at = 0;
            for (const m of s.matchAll(LINK)) {
                if (m.index! > at) out.push({ text: s.slice(at, m.index) });
                out.push(m[3] ? { text: shortUrl(m[3]), url: m[3] } : { text: m[1], url: m[2] });
                at = m.index! + m[0].length;
            }
            if (at < s.length) out.push({ text: s.slice(at) });
            return out;
        });
}
