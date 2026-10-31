import { execFile } from "child_process";
import type { DonePr } from "./group";

// The PR list holds open PRs and unreleased merged ones of yours; a session's other PRs (merged
// and released, closed, or someone else's) are asked about by URL. Done is final, so once each.
const PR_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/;
// GitHub caps a query's cost; fifty aliases stay well under it.
const BATCH = 50;

export const unlisted = (urls: string[], listed: Set<string>, done: Record<string, DonePr>): string[] =>
    [...new Set(urls)].filter((u) => PR_URL.test(u) && !listed.has(u) && !done[u]);

export const doneQuery = (urls: string[]) =>
    `{${urls.map((u, i) => `p${i}:resource(url:${JSON.stringify(u)}){... on PullRequest{url number state repository{nameWithOwner}}}`).join(" ")}}`;

type Resource = { url: string; number: number; state: string; repository: { nameWithOwner: string } } | null;
export const doneFrom = (data: Record<string, Resource>): DonePr[] =>
    Object.values(data)
        .filter((n): n is NonNullable<Resource> => !!n && (n.state === "MERGED" || n.state === "CLOSED"))
        .map((n) => ({ url: n.url, number: n.number, repo: n.repository.nameWithOwner, merged: n.state === "MERGED" }));

// With some PRs out of reach GitHub still answers the others, and gh exits non-zero.
const gh = (args: string[]) =>
    new Promise<string>((resolve, reject) => execFile("gh", args, { timeout: 30_000, maxBuffer: 8 << 20 }, (err, out) => (out ? resolve(out) : reject(err))));

// Fail-open per batch: a PR not answered is asked again next time.
export async function fetchDone(urls: string[]): Promise<DonePr[]> {
    const out: DonePr[] = [];
    for (let i = 0; i < urls.length; i += BATCH) {
        try {
            out.push(...doneFrom(JSON.parse(await gh(["api", "graphql", "-f", `query=${doneQuery(urls.slice(i, i + BATCH))}`])).data ?? {}));
        } catch {}
    }
    return out;
}
