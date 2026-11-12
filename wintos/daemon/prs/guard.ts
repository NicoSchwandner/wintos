// The commands a session could run by accident on a PR another session owns: a push to its branch,
// or a comment or review on it. What the command names, so the daemon can find the PR: a link, a
// number with its repo, or for a push the branch and the directory it runs in.
// WINTOS_NOT_MINE=1 in front of the command: the session means it, this once.
export type GuardTarget = { kind: "push" | "comment"; url?: string; number?: number; repo?: string; branch?: string; dir?: string };

const PR_URL = /https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/(\d+)/;

export function guardTarget(command: string): GuardTarget | undefined {
    if (/\bWINTOS_NOT_MINE=1\b/.test(command)) return undefined;
    // The last segment that runs one of them, and a `cd <dir>` earlier in the same command.
    const parts = command.split(/&&|;|\|\|/).map((p) => p.trim());
    const runs = (p: string) => /^(git\b.*\bpush\b|gh pr (comment|review)\b)/.test(p.replace(/^\w+=\S+\s+/, ""));
    const at = parts.map(runs).lastIndexOf(true);
    if (at < 0) return undefined;
    const part = parts[at];
    const cd = parts.slice(0, at).reverse().map((p) => /^cd\s+("[^"]+"|'[^']+'|\S+)/.exec(p)?.[1]).find(Boolean);
    const unq = (s: string | undefined) => s?.replace(/^["']|["']$/g, "");
    const dir = unq(/\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/.exec(part)?.[1]) ?? unq(cd);
    const link = PR_URL.exec(part);
    if (/^gh pr (comment|review)\b/.test(part.replace(/^\w+=\S+\s+/, ""))) {
        if (link) return { kind: "comment", url: link[0] };
        const n = /gh pr (?:comment|review)\s+(\d+)\b/.exec(part)?.[1];
        const repo = /(?:-R|--repo)[ =]([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/.exec(part)?.[1];
        return n ? { kind: "comment", number: Number(n), ...(repo ? { repo } : {}), ...(dir ? { dir } : {}) } : undefined;
    }
    // git push [flags] [remote] [refspec]: the branch is the refspec's target, else the checkout's.
    const args = part.replace(/^.*?\bpush\b/, "").trim().split(/\s+/).filter((a) => a && !a.startsWith("-"));
    const ref = args[1]?.split(":").pop()?.replace(/^refs\/heads\//, "").replace(/^\+/, "");
    return { kind: "push", ...(ref && ref !== "HEAD" ? { branch: ref } : {}), ...(dir ? { dir } : {}) };
}

// The repo a remote URL points at: owner/name, from an https or ssh remote.
export const repoOfRemote = (remote: string) => /github\.com[/:]([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(remote.trim())?.[1];
