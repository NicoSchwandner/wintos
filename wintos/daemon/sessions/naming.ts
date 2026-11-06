import type { Session } from "./reduce";

const PROMPTS_KEPT = 6;
const PROMPT_MAX = 240;

// The prompts you wrote in a session, from its transcript: what it is about, in your words. Tool
// results and the harness's own messages (tagged, or marked meta) are not yours.
export function userPrompts(jsonl: string): string[] {
    const out: string[] = [];
    for (const line of jsonl.split("\n")) {
        try {
            const e = JSON.parse(line) as { type?: string; isMeta?: boolean; message?: { content?: unknown } };
            const text = e.type === "user" && !e.isMeta && typeof e.message?.content === "string" ? e.message.content.trim() : "";
            if (text && !text.startsWith("<")) out.push(text.replace(/<pasted_content[\s\S]*?<\/pasted_content[^>]*>/g, "[pasted]").replace(/\s+/g, " ").slice(0, PROMPT_MAX));
        } catch {}
    }
    // The first ones set the subject, the last ones where it went.
    return out.length > PROMPTS_KEPT ? [...out.slice(0, 3), ...out.slice(-3)] : out;
}

// When to name it again: once its PRs or its lane changed, the subject may have.
export const nameKey = (s: Session) => `${(s.prs ?? []).join(",")}|${s.lane?.name ?? ""}`;

export function namePrompt(s: { project?: string; prompts: string[]; prs: string[]; lane?: string; branch?: string }): string {
    return [
        "Name this coding session in 3 to 6 words, like a browser tab title, so its developer recognises it among the",
        "other sessions of the same project. Name the concrete thing it works on: a PR number, a ticket id, a component,",
        'a behaviour (e.g. "#108 retention backfill: review fixes", "DEV-29980 hand-off reason codes"). Leave out the',
        'project\'s own name and words like "session" or "follow-up". English. Reply with the name only.',
        "",
        s.project && `Project: ${s.project}`,
        s.lane && `Its kind of work: ${s.lane}`,
        s.branch && `Branch: ${s.branch}`,
        s.prs.length > 0 && `Its PRs:\n${s.prs.map((p) => `- ${p}`).join("\n")}`,
        s.prompts.length > 0 && `What the developer asked it, in order:\n${s.prompts.map((p) => `- ${p}`).join("\n")}`,
    ]
        .filter((l): l is string => typeof l === "string")
        .join("\n");
}
