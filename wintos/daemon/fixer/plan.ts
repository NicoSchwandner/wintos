import { redChecks, type Group, type PR } from "../prs/group";
import type { Session } from "../sessions/reduce";
import type { Shelf } from "../shelf/shelf";

// Where a fix runs. pane: typed into the live session that owns the PR; resume: that shelved
// session continued headless under its own id; fresh: a new headless run.
export type FixKind = "conflict" | "ci" | "comments" | "rereview" | "merge";
// review: a first look, which needs you in it, so it opens a session of its own instead of a run.
export type NextKind = FixKind | "review";
export type Route = { kind: "pane"; tabId: string; blockId: string; sessionId: string } | { kind: "resume"; sessionId: string; script: string } | { kind: "fresh" };
export type FixJob = { kind: FixKind; pr: PR; route: Route };

// One attempt per PR, kind and head commit: a fix that fails stays the developer's until the PR moves.
export const fixKey = (kind: FixKind, pr: PR) => `${kind}:${pr.url}@${pr.head}`;

const mineOpen = (pr: PR, me: string) => pr.author === me && !pr.mergedAt && !!pr.head;

// A conflict needs no context from the session that wrote the PR, so it never wakes one.
export function conflictJobs(prs: PR[], me: string, tried: Set<string>): FixJob[] {
    return prs.filter((pr) => mineOpen(pr, me) && pr.conflict && !tried.has(fixKey("conflict", pr))).map((pr) => ({ kind: "conflict", pr, route: { kind: "fresh" } }));
}

// f on a PR row: the one step that moves it on from here. undefined: nothing to do but wait.
export function nextAction(pr: PR, me: string, group: Group): NextKind | undefined {
    if (pr.mergedAt) return undefined;
    if (pr.author !== me) return group === "review" || group === "team" ? (pr.reviewedByMe ? "rereview" : "review") : undefined;
    if (pr.conflict) return "conflict";
    if (redChecks(pr)) return "ci";
    if (group === "merge") return "merge";
    if ((pr.reviewDecision === "CHANGES_REQUESTED" && !pr.changesRerequested) || pr.openThreads) return "comments";
    return undefined;
}

// Everything but a conflict goes back to the session that knows the code: for a re-review, the
// one that reviewed it, which holds the PR as its own or as "also in".
export function fixJob(pr: PR, sessions: Session[], shelf: Shelf, kind: FixKind = "ci"): FixJob {
    const holds = (x: { prs?: string[]; touched?: string[] }) => !!x.prs?.includes(pr.url) || (kind === "rereview" && !!x.touched?.includes(pr.url));
    const live = sessions.find((s) => s.state !== "ended" && holds(s));
    if (live) return { kind, pr, route: { kind: "pane", tabId: live.tabId, blockId: live.blockId, sessionId: live.id } };
    const shelved = Object.values(shelf).flat().find(holds);
    if (shelved) return { kind, pr, route: { kind: "resume", sessionId: shelved.sessionId, script: shelved.script } };
    return { kind, pr, route: { kind: "fresh" } };
}

export function fixPrompt(job: FixJob): string {
    const { pr } = job;
    if (job.kind === "conflict")
        return `${pr.url} has merge conflicts with its base (${pr.base ?? "its base branch"}). Resolve them with the resolving-merge-conflicts skill, given this PR link: it merges the base in, resolves each hunk from the intent of both sides, runs the repo's checks, commits and pushes to ${pr.branch}. Never force-push, and never rewrite a branch already merged into test. If a hunk can't be resolved with confidence, leave the PR as it is and end with one line saying which file and why.`;
    if (job.kind === "comments")
        return `${pr.url} has review feedback waiting. Work it with the receiving-code-review skill: verify each comment against the code, fix what holds and answer what doesn't, run the tests, push to ${pr.branch}, then ask everyone who requested changes to review again.`;
    if (job.kind === "rereview") return `${pr.url} asks for your review again. Re-review what changed since your last review, as the review lane says for a re-review.`;
    if (job.kind === "merge") return `The developer asked to merge ${pr.url}: it is approved and green. Merge it with gh pr merge, using the merge method this repo's merged PRs use. Don't delete the branch or its worktree.`;
    return `CI is red on ${pr.url} (head ${pr.head}). Find out why from the failed checks. A real failure: fix it, run the tests, commit and push to ${pr.branch}. A flaky or infrastructure failure: rerun the failed jobs (gh run rerun <run-id> --failed). One attempt: if you can't fix it, leave the PR as it is and end with one line saying why.`;
}
