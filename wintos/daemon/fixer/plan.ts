import type { PR } from "../prs/group";
import type { Session } from "../sessions/reduce";
import type { Shelf } from "../shelf/shelf";

// Where a fix runs. pane: typed into the live session that owns the PR; resume: that shelved
// session continued headless under its own id; fresh: a new headless run.
export type FixKind = "conflict" | "ci";
export type Route = { kind: "pane"; tabId: string; blockId: string; sessionId: string } | { kind: "resume"; sessionId: string; script: string } | { kind: "fresh" };
export type FixJob = { kind: FixKind; pr: PR; route: Route };

// One attempt per PR, kind and head commit: a fix that fails stays the developer's until the PR moves.
export const fixKey = (kind: FixKind, pr: PR) => `${kind}:${pr.url}@${pr.head}`;

const mineOpen = (pr: PR, me: string) => pr.author === me && !pr.mergedAt && !!pr.head;

// A conflict needs no context from the session that wrote the PR, so it never wakes one.
export function conflictJobs(prs: PR[], me: string, tried: Set<string>): FixJob[] {
    return prs.filter((pr) => mineOpen(pr, me) && pr.conflict && !tried.has(fixKey("conflict", pr))).map((pr) => ({ kind: "conflict", pr, route: { kind: "fresh" } }));
}

// Red CI goes back to the session that knows the code.
export function fixJob(pr: PR, sessions: Session[], shelf: Shelf): FixJob {
    const live = sessions.find((s) => s.state !== "ended" && s.prs?.includes(pr.url));
    if (live) return { kind: "ci", pr, route: { kind: "pane", tabId: live.tabId, blockId: live.blockId, sessionId: live.id } };
    const shelved = Object.values(shelf).flat().find((s) => s.prs?.includes(pr.url));
    if (shelved) return { kind: "ci", pr, route: { kind: "resume", sessionId: shelved.sessionId, script: shelved.script } };
    return { kind: "ci", pr, route: { kind: "fresh" } };
}

export function fixPrompt(job: FixJob): string {
    const { pr } = job;
    if (job.kind === "conflict")
        return `${pr.url} has merge conflicts with its base (${pr.base ?? "its base branch"}). Resolve them with the resolving-merge-conflicts skill, given this PR link: it merges the base in, resolves each hunk from the intent of both sides, runs the repo's checks, commits and pushes to ${pr.branch}. Never force-push, and never rewrite a branch already merged into test. If a hunk can't be resolved with confidence, leave the PR as it is and end with one line saying which file and why.`;
    return `CI is red on ${pr.url} (head ${pr.head}). Find out why from the failed checks. A real failure: fix it, run the tests, commit and push to ${pr.branch}. A flaky or infrastructure failure: rerun the failed jobs (gh run rerun <run-id> --failed). One attempt: if you can't fix it, leave the PR as it is and end with one line saying why.`;
}
