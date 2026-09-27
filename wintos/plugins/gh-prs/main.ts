// wintos plugin: open pull requests that concern you, as JSON on stdout: {"me", "prs": PR[]}.
// The same three searches as github.com/pulls: yours, asked of you, asked of your teams.
import { execFileSync } from "child_process";
import { normalize, type Node } from "./normalize";

const FIELDS = `number title url isDraft createdAt author{login} repository{nameWithOwner} headRefName
  reviewDecision mergeable mergeStateStatus additions deletions
  commits(last:1){nodes{commit{statusCheckRollup{state}}}}
  reviewRequests(first:10){nodes{requestedReviewer{__typename ... on User{login} ... on Team{name} ... on Bot{login}}}}
  latestReviews(first:20){nodes{author{login} state submittedAt}}`;
const QUERY = `query($q:String!){search(query:$q,type:ISSUE,first:100){nodes{... on PullRequest{${FIELDS}}}}}`;

const gh = (args: string[]) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 30_000 });
const search = (q: string): Node[] =>
    JSON.parse(gh(["api", "graphql", "-f", `query=${QUERY}`, "-f", `q=is:pr is:open archived:false ${q}`])).data.search.nodes.filter(Boolean);

const me = gh(["api", "user", "--jq", ".login"]).trim();
const direct = search("user-review-requested:@me");
const teams = search("review-requested:@me");
// No age bound: your oldest open PRs are exactly the ones Chase is for.
const mine = search("author:@me");

const byUrl = new Map<string, ReturnType<typeof normalize>>();
const directUrls = new Set(direct.map((n) => n.url));
for (const n of [...mine, ...teams, ...direct])
    byUrl.set(n.url, normalize(n, me, { requestedMe: directUrls.has(n.url), requestedTeam: !directUrls.has(n.url) && teams.some((t) => t.url === n.url) }));
process.stdout.write(JSON.stringify({ me, prs: [...byUrl.values()] }));
