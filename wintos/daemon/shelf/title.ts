import { execFile } from "child_process";

// A shelved session's title: 3 to 6 words to find it again at a glance, written by the same
// one-shot model command as the daily recap (WINTOS_RECAP_CMD).
export function titlePrompt(s: { project?: string; gist?: string; status?: string; label?: string }): string {
    return [
        "Name this paused coding session in 3 to 6 words, like a browser tab title: what the work is, not how it went",
        '(e.g. "Deploy HeartMcp stack to test", "Flag proposals under edited routines"). It is shown inside the project,',
        "so leave the project's name out. Reply with the title only.",
        "",
        s.project && `Project: ${s.project}`,
        s.gist && `What it was last about: ${s.gist}`,
        s.status && `Its status line: ${s.status}`,
        s.label && `Its first prompt: ${s.label}`,
    ]
        .filter((l): l is string => typeof l === "string")
        .join("\n");
}

export function parseTitle(out: string): string | undefined {
    const line = out.split("\n").map((l) => l.trim()).find(Boolean);
    const t = line?.replace(/^["'“”]+|["'“”]+$/g, "").replace(/[.!]+$/, "").trim();
    return t && t.split(/\s+/).length <= 8 && t.length <= 60 ? t : undefined;
}

// One prompt through the one-shot model command; undefined when it fails.
export const oneShot = (cmd: string, prompt: string): Promise<string | undefined> =>
    new Promise((resolve) => {
        const child = execFile("/bin/sh", ["-c", cmd], { timeout: 120_000, maxBuffer: 1 << 16 }, (err, out) => resolve(err ? undefined : String(out)));
        child.stdin?.end(prompt);
    });

export const writeTitle = async (cmd: string, prompt: string): Promise<string | undefined> => {
    const out = await oneShot(cmd, prompt);
    return out === undefined ? undefined : parseTitle(out);
};
