import { execFile } from "child_process";
import { rollup, type PrNow } from "./wakes";

// main is where a release lands; a repo without one releases on the merge itself.
const RELEASE_BRANCH = "main";
const gh = (args: string[]) =>
    new Promise<string>((resolve, reject) => execFile("gh", args, { timeout: 30_000, maxBuffer: 8 << 20 }, (err, out) => (err ? reject(err) : resolve(out))));

// A PR's state for its wakes, straight from GitHub: a PR merged into main has left the PR list.
// undefined when GitHub can't be asked; the wake waits for the next check.
export async function prNow(url: string): Promise<PrNow | undefined> {
    try {
        const pr = JSON.parse(await gh(["pr", "view", url, "--json", "state,baseRefName,mergeCommit,statusCheckRollup"])) as {
            state: PrNow["state"];
            baseRefName: string;
            mergeCommit?: { oid: string } | null;
            statusCheckRollup?: { status?: string; conclusion?: string; state?: string }[];
        };
        const merged = pr.state === "MERGED";
        return { state: pr.state, checks: rollup(pr.statusCheckRollup ?? []), released: merged && (pr.baseRefName === RELEASE_BRANCH || (await onMain(url, pr.mergeCommit?.oid))) };
    } catch {
        return undefined;
    }
}

async function onMain(url: string, oid: string | undefined): Promise<boolean> {
    const repo = /github\.com\/([^/]+\/[^/]+)\/pull/.exec(url)?.[1];
    if (!repo || !oid) return false;
    try {
        const status = (await gh(["api", `repos/${repo}/compare/${RELEASE_BRANCH}...${oid}`, "--jq", ".status"])).trim();
        return status === "behind" || status === "identical";
    } catch (e) {
        return /HTTP 404/.test(String((e as { stderr?: string }).stderr ?? e));
    }
}
