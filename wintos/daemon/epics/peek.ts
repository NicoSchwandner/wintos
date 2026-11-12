import { closeSync, openSync, readSync, statSync } from "fs";
import { freshStatus, type Session } from "../sessions/reduce";

// `wintos peek <session>`: what the epic agent sees of one session beyond its digest line: its
// state and step, the question it asks in full, its PRs and whether they are done, and its last
// reply as it wrote it.
const REPLY_MAX = 4000;
const TAIL_BYTES = 1 << 19;

// The last reply in a transcript (Claude's jsonl): the text of its last assistant message.
export function lastReply(jsonl: string): string | undefined {
    const lines = jsonl.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
        try {
            const m = JSON.parse(lines[i]);
            if (m?.type !== "assistant") continue;
            const parts = Array.isArray(m.message?.content) ? m.message.content : [];
            const text = parts.filter((p: { type?: string }) => p?.type === "text").map((p: { text?: string }) => p.text ?? "").join("\n").trim();
            if (text) return text.length > REPLY_MAX ? `…${text.slice(-REPLY_MAX)}` : text;
        } catch {
            // a line cut by the tail read, or not JSON: skip it
        }
    }
    return undefined;
}

// The end of a transcript only: they grow to many megabytes.
export function readTail(path: string): string | undefined {
    try {
        const size = statSync(path).size;
        const fd = openSync(path, "r");
        try {
            const len = Math.min(size, TAIL_BYTES);
            const buf = Buffer.alloc(len);
            readSync(fd, buf, 0, len, size - len);
            return buf.toString("utf8");
        } finally {
            closeSync(fd);
        }
    } catch {
        return undefined;
    }
}

export function peekText(s: Session, more: { step?: string; prs: { url: string; state: string }[]; reply?: string }): string {
    const ask = s.ask;
    const lines = [
        `${s.name?.text ?? s.label ?? s.id}: ${s.state}${s.bgId ? " (in the background)" : ""}${more.step ? `, works the step "${more.step}"` : ""}`,
        freshStatus(s) && `status: ${freshStatus(s)!.text}`,
        s.parkedOn && `paused on: ${s.parkedOn}`,
        ask && `asks the developer (${ask.kind}): ${ask.text ?? "see its reply"}${ask.context ? ` — about ${ask.context}` : ""}`,
        ...(ask?.options ?? []).map((o, i) => `  option ${i + 1}: ${o.label}${o.then ? ` → ${o.then}` : ""}`),
        ask?.suggestion && `your suggestion on it: ${ask.suggestion}`,
        more.prs.length ? `PRs: ${more.prs.map((p) => `${p.url} (${p.state})`).join(", ")}` : undefined,
        more.reply ? `its last reply:\n${more.reply}` : "its last reply: none read",
    ];
    return lines.filter(Boolean).join("\n");
}
