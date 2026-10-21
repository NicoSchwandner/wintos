import { execFile } from "child_process";
import { isLogic, rollup, type PrNow, type WakeEvent } from "./wakes";

// main is where a release lands; a repo without one releases on the merge itself.
const RELEASE_BRANCH = "main";
// Machines: their reviews and comments are no feedback a person gave.
const BOT = /\[bot\]$|^github-actions$|copilot/i;
const gh = (args: string[]) =>
    new Promise<string>((resolve, reject) => execFile("gh", args, { timeout: 30_000, maxBuffer: 8 << 20 }, (err, out) => (err ? reject(err) : resolve(out))));

type Review = { author?: { login: string } | null; submittedAt?: string; commit?: { oid: string } | null };
type Viewed = {
    state: PrNow["state"];
    baseRefName: string;
    headRefOid: string;
    mergeCommit?: { oid: string } | null;
    statusCheckRollup?: { status?: string; conclusion?: string; state?: string }[];
    reviews?: Review[];
    comments?: { author?: { login: string } | null; createdAt?: string }[];
};
// who: you, and the reviewers that count as your team (the team itself first).
export type Who = { me: string; team?: string[] };

// A PR's state for its wakes, straight from GitHub: a PR merged into main has left the PR list.
// events: what its wakes wait for, so a review's extra lookups are made only when one does.
// undefined when GitHub can't be asked; the wake waits for the next check.
export async function prNow(url: string, who: Who, events: WakeEvent[]): Promise<PrNow | undefined> {
    try {
        const pr = JSON.parse(await gh(["pr", "view", url, "--json", "state,baseRefName,headRefOid,mergeCommit,statusCheckRollup,reviews,comments"])) as Viewed;
        const merged = pr.state === "MERGED";
        const out: PrNow = { state: pr.state, checks: rollup(pr.statusCheckRollup ?? []), released: merged && (pr.baseRefName === RELEASE_BRANCH || (await onMain(url, pr.mergeCommit?.oid))) };
        if (events.includes("comments")) out.feedbackAt = feedbackAt(pr, who.me);
        if (events.includes("rereview") && pr.state === "OPEN") {
            const mine = (pr.reviews ?? []).filter((r) => r.author?.login === who.me && r.submittedAt).sort((a, b) => a.submittedAt!.localeCompare(b.submittedAt!)).pop();
            if (mine && (await requestedSince(url, who, Date.parse(mine.submittedAt!)))) {
                out.requestedAgain = true;
                out.logicLines = mine.commit?.oid ? await logicLines(url, mine.commit.oid, pr.headRefOid) : undefined;
            }
        }
        return out;
    } catch {
        return undefined;
    }
}

function feedbackAt(pr: Viewed, me: string): number | undefined {
    const times = [
        ...(pr.reviews ?? []).map((r) => ({ who: r.author?.login, at: r.submittedAt })),
        ...(pr.comments ?? []).map((c) => ({ who: c.author?.login, at: c.createdAt })),
    ].filter((x) => x.who && x.who !== me && !BOT.test(x.who) && x.at).map((x) => Date.parse(x.at!));
    return times.length ? Math.max(...times) : undefined;
}

const parts = (url: string) => /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url);

// A request for your review, or your team's, made after your last review.
async function requestedSince(url: string, who: Who, since: number): Promise<boolean> {
    const m = parts(url);
    if (!m) return false;
    const query = `query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){timelineItems(last:30,itemTypes:[REVIEW_REQUESTED_EVENT]){nodes{... on ReviewRequestedEvent{createdAt requestedReviewer{... on User{login} ... on Team{name}}}}}}}}`;
    const out = JSON.parse(await gh(["api", "graphql", "-f", `query=${query}`, "-F", `o=${m[1]}`, "-F", `r=${m[2]}`, "-F", `n=${m[3]}`])) as {
        data: { repository: { pullRequest: { timelineItems: { nodes: { createdAt: string; requestedReviewer?: { login?: string; name?: string } | null }[] } } } };
    };
    const us = new Set([who.me, ...(who.team ?? [])]);
    return out.data.repository.pullRequest.timelineItems.nodes.some((e) => Date.parse(e.createdAt) > since && us.has(e.requestedReviewer?.login ?? e.requestedReviewer?.name ?? ""));
}

// What changed since your review in the files the PR changes: a base merged into the branch
// brings in files that are not the PR's. ponytail: the compare lists at most 300 files; a
// bigger change is over the limit anyway.
async function logicLines(url: string, from: string, to: string): Promise<number | undefined> {
    const m = parts(url);
    if (!m) return undefined;
    try {
        const [changed, own] = await Promise.all([
            gh(["api", `repos/${m[1]}/${m[2]}/compare/${from}...${to}`, "--jq", "[.files[] | {f: .filename, n: .changes}]"]),
            gh(["api", "--paginate", `repos/${m[1]}/${m[2]}/pulls/${m[3]}/files`, "--jq", ".[].filename"]),
        ]);
        const prFiles = new Set(own.split("\n").filter(Boolean));
        return (JSON.parse(changed) as { f: string; n: number }[]).filter((x) => prFiles.has(x.f) && isLogic(x.f)).reduce((n, x) => n + x.n, 0);
    } catch {
        return undefined;
    }
}

async function onMain(url: string, oid: string | undefined): Promise<boolean> {
    const m = parts(url);
    if (!m || !oid) return false;
    try {
        const status = (await gh(["api", `repos/${m[1]}/${m[2]}/compare/${RELEASE_BRANCH}...${oid}`, "--jq", ".status"])).trim();
        return status === "behind" || status === "identical";
    } catch (e) {
        return /HTTP 404/.test(String((e as { stderr?: string }).stderr ?? e));
    }
}
