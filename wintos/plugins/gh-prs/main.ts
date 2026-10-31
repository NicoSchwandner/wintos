// wintos plugin: open pull requests that concern you, as JSON on stdout: {"me", "prs": PR[], "team"?}.
// The same three searches as github.com/pulls: yours, asked of you, asked of your teams; plus
// yours merged in the last month but not yet released to main.
import { execFileSync } from "child_process";
import { linkStacks, normalize, orgQualifier, unreleased, type Node } from "./normalize";

const FIELDS = `number title url isDraft createdAt author{login} repository{nameWithOwner defaultBranchRef{name}} headRefName baseRefName
  reviewDecision mergeable mergeStateStatus additions deletions
  commits(last:1){nodes{commit{oid committedDate statusCheckRollup{state}}}}
  timelineItems(last:10,itemTypes:[REVIEW_REQUESTED_EVENT,READY_FOR_REVIEW_EVENT,ISSUE_COMMENT]){nodes{__typename ... on ReviewRequestedEvent{createdAt} ... on ReadyForReviewEvent{createdAt} ... on IssueComment{createdAt author{login}}}}
  reviewRequests(first:10){nodes{requestedReviewer{__typename ... on User{login} ... on Team{name} ... on Bot{login}}}}
  latestReviews(first:20){nodes{author{login} state submittedAt}}
  pending:reviews(states:PENDING,first:1){nodes{comments{totalCount}}}`;
const query = (fields: string) => `query($q:String!){search(query:$q,type:ISSUE,first:100){nodes{... on PullRequest{${fields}}}}}`;
// Merged PRs need little, and the full field set over a month of merges makes GitHub time out.
const MERGED_FIELDS = `number title url isDraft createdAt author{login} repository{nameWithOwner defaultBranchRef{name}} headRefName baseRefName additions deletions mergedAt mergeCommit{oid}`;

const gh = (args: string[]) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 30_000 });
const orgs = orgQualifier(process.env.WINTOS_GH_ORGS);
const search = (q: string, state = "is:open", fields = FIELDS): Node[] =>
    JSON.parse(gh(["api", "graphql", "-f", `query=${query(fields)}`, "-f", `q=is:pr ${state} archived:false ${orgs} ${q}`])).data.search.nodes.filter(Boolean);

const me = gh(["api", "user", "--jq", ".login"]).trim();
const direct = search("user-review-requested:@me");
const teams = search("review-requested:@me");
// No age bound: your oldest open PRs are exactly the ones Chase is for.
const mine = search("author:@me");

// Only repos that merge into another branch than main release later; one compare each lists
// what main is still missing.
const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
// Fail-open: the open PRs matter more than the release reminder.
let found: Node[] = [];
try {
    found = search(`author:@me merged:>=${since}`, "is:merged", MERGED_FIELDS).map((n) => ({ ...n, reviewDecision: null, mergeable: "UNKNOWN", commits: { nodes: [] }, reviewRequests: { nodes: [] }, latestReviews: { nodes: [] } }));
} catch {}
const merged = found.filter((n) => n.baseRefName === n.repository.defaultBranchRef?.name && n.baseRefName !== "main");
const ahead: Record<string, Set<string>> = {};
for (const n of merged) {
    const repo = n.repository.nameWithOwner;
    if (repo in ahead) continue;
    try {
        // ponytail: the compare lists at most 250 commits; a repo further behind needs paging.
        ahead[repo] = new Set(gh(["api", `repos/${repo}/compare/main...${n.baseRefName}`, "--jq", ".commits[].sha"]).split("\n").filter(Boolean));
    } catch {
        ahead[repo] = new Set(); // no main branch: nothing to release
    }
}

// An open PR from the branch into main is the release; fail-open: without it, it asks for one.
const releases: Record<string, { url: string; draft: boolean }> = {};
for (const n of unreleased(merged, ahead)) {
    const repo = n.repository.nameWithOwner;
    if (repo in releases) continue;
    try {
        const open = JSON.parse(gh(["pr", "list", "-R", repo, "--base", "main", "--head", n.baseRefName!, "--state", "open", "--json", "url,isDraft"])) as { url: string; isDraft: boolean }[];
        const pr = open.find((p) => !p.isDraft) ?? open[0];
        if (pr) releases[repo] = { url: pr.url, draft: pr.isDraft };
    } catch {}
}

const byUrl = new Map<string, ReturnType<typeof normalize>>();
const directUrls = new Set(direct.map((n) => n.url));
for (const n of [...unreleased(merged, ahead), ...mine, ...teams, ...direct]) {
    const pr = normalize(n, me, { requestedMe: directUrls.has(n.url), requestedTeam: !directUrls.has(n.url) && teams.some((t) => t.url === n.url) });
    const release = pr.mergedAt ? releases[pr.repo] : undefined;
    byUrl.set(n.url, release ? { ...pr, releasePr: release } : pr);
}
// Open threads only matter for your approved PRs GitHub blocks (the conversation rule); asking
// for them in the search made it too heavy for GitHub (HTTP 502). Fail-open: a miss keeps it blocked.
for (const pr of byUrl.values()) {
    if (pr.author !== me || pr.reviewDecision !== "APPROVED" || pr.mergeState !== "BLOCKED") continue;
    const [owner, name] = pr.repo.split("/");
    try {
        const open = Number(gh(["api", "graphql", "-F", `n=${pr.number}`, "-f", `o=${owner}`, "-f", `r=${name}`, "-f",
            "query=query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{isResolved}}}}}",
            "--jq", "[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved | not)] | length"]));
        if (open) pr.openThreads = open;
    } catch {}
}
// WINTOS_TEAM (org/team-slug): your own team, as the reviewers that count as it: the team itself
// and its members. A failed lookup leaves it out rather than failing the PRs.
const teamSpec = /^([^/\s]+)\/([^/\s]+)$/.exec(process.env.WINTOS_TEAM ?? "");
let team: string[] | undefined;
if (teamSpec) {
    try {
        const [, org, slug] = teamSpec;
        team = [gh(["api", `orgs/${org}/teams/${slug}`, "--jq", ".name"]).trim(), ...gh(["api", "--paginate", `orgs/${org}/teams/${slug}/members`, "--jq", ".[].login"]).split("\n").filter(Boolean)];
    } catch {}
}
process.stdout.write(JSON.stringify({ me, prs: linkStacks([...byUrl.values()]), ...(team ? { team } : {}) }));
