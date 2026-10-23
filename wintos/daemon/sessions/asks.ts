import { ASK_KINDS, type Ask, type AskKind } from "./reduce";

const MESSAGE_TAIL = 3000;
const ASK_TEXT_MAX = 90;
// A question this close to the end of a reply is what the reply leaves the developer with.
const QUESTION_TAIL = 600;

// For a turn that ended without saying what it expects (no `wintos ask`, wait or done).
export function askPrompt(message: string): string {
    return [
        "A coding agent ended its turn with the message below. Say what it now expects of the developer, as one line",
        "`<kind>: <what, in at most 10 words>`, where kind is one of:",
        "- answer: it asked them a question",
        "- decide: it laid out options and they pick one",
        "- approve: a plan, a change or a step waits for their go",
        "- unblock: it needs them to do something it can't (a login, an unlock, a manual step)",
        "- read: it only reports (done, a status, an analysis, a PR to look at); nothing waits on them",
        'E.g. "decide: two bands or one marked band", "read: momentum fix is live". Reply with the line only.',
        "",
        "Message:",
        message.slice(-MESSAGE_TAIL),
    ].join("\n");
}

const clip = (t: string) => (t.length > ASK_TEXT_MAX ? `${t.slice(0, ASK_TEXT_MAX - 1).trimEnd()}…` : t);

export function parseAsk(out: string): Ask | "done" | undefined {
    const m = /^\W*(answer|decide|approve|unblock|read)\b\W*(.*)$/i.exec(out.split("\n").map((l) => l.trim()).find(Boolean) ?? "");
    if (!m) return undefined;
    const kind = m[1].toLowerCase();
    if (kind === "read") return "done";
    const text = m[2].replace(/^["'“`]+|["'”.`]+$/g, "").trim();
    return { kind: kind as AskKind, ...(text ? { text: clip(text) } : {}), by: "model" };
}

// When the model can't be asked: a question near the end asks, anything else only reports.
export function guessAsk(message: string): Ask | "done" {
    const tail = message.replace(/[*_`]+/g, "").slice(-QUESTION_TAIL);
    const question = tail.match(/[^.!?\n]*\?/g)?.pop()?.replace(/^[\s>*+-]+/, "").trim();
    return question ? { kind: "answer", text: clip(question), by: "guess" } : "done";
}

export const isAskKind = (k: unknown): k is AskKind => (ASK_KINDS as readonly unknown[]).includes(k);
