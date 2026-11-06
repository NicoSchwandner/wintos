import { ghPrs, type WintosState } from "./view";

// A PR reference Claude writes: #352, Core#14129 or acme/api#77.
export type Ref = { repo?: string; number: number };

// A bare #N needs two digits: "step #1" is prose far more often than a PR. An owner has no
// dots (GitHub allows none), so a URL like x.com/a#123 is no owner/repo.
const REF = /(?<![\w/#.-])(?:([\w-]+\/[\w.-]+|[\w.-]+)#(\d+)|#(\d{2,}))(?![\w#])/g;

export function findRefLinks(line: string): (Ref & { start: number; end: number })[] {
    return [...line.matchAll(REF)].map((m) => ({
        start: m.index,
        end: m.index + m[0].length,
        ...(m[1] && { repo: m[1] }),
        number: Number(m[2] ?? m[3]),
    }));
}

const prUrl = (repo: string, n: number) => `https://github.com/${repo}/pull/${n}`;
const repoOf = (url: string) => /github\.com\/([^/]+\/[^/]+)\/pull\//.exec(url)?.[1];

// Where a reference points, from what this pane's session and the PR list know; no guess when
// two PRs could be meant.
export function resolveRef(ref: Ref, state: WintosState, blockId: string): string | undefined {
    if (ref.repo?.includes("/")) return prUrl(ref.repo, ref.number);
    const mine = state.sessions.filter((s) => s.blockId === blockId && s.state !== "ended").flatMap((s) => s.prs ?? []);
    const known = [...mine, ...(ghPrs(state)?.prs ?? []).map((p) => p.url)];
    if (ref.repo) {
        const name = ref.repo.toLowerCase();
        const repo = known.map(repoOf).find((r) => r?.split("/")[1].toLowerCase() === name);
        return repo && prUrl(repo, ref.number);
    }
    const own = mine.filter((u) => u.endsWith(`/pull/${ref.number}`));
    if (own.length === 1) return own[0];
    const open = [...new Set(known.filter((u) => u.endsWith(`/pull/${ref.number}`)))];
    return open.length === 1 ? open[0] : undefined;
}
