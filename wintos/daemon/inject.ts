import { join } from "path";
import type { Project } from "./projects/store";

// WintOS shows a session whose turn ended as waiting on the developer; this is how Claude says
// what it expects of them, or that it is waiting on something else.
const WAIT_RULE = `[WintOS] Every turn you end is shown to the developer as "your turn" unless you say otherwise. Just before you stop, read your final message and pick one:
- It asks the developer something: run \`wintos ask <kind> "<what you need, a few words>"\`, then stop. kind: answer (a question), decide (options to pick from), approve (a plan, a change or a step waiting for their go), unblock (something only they can do: a login, an unlock, a manual step).
- It waits on something outside this conversation (a review, CI, a deploy, a merge, a background job): run \`wintos wait "<what, e.g. review on #123>"\`, then stop. This holds even when you told the developer you are waiting; telling them is not an ask. When it is one of these and you know what you will do then, run \`wintos wake <event> <owner/repo#n> "<what you will do then>"\` instead: WintOS types that into this pane when it happens, so nobody has to come back and prompt you. Prefer it to a watcher of your own. Events: green, merged, released; rereview (after you posted a review asking for changes: you or your team are asked to review again); comments (your PR waits for review: someone reviewed or commented). WintOS adds the guard rails itself: a big re-review or a comment on the approach comes back to the developer.
- A prompt starting \`[WintOS wake: …]\` is your own wake: do what it says, and stop at whatever needs the developer as you always would (an ask, not an action on their behalf).
- The goal is met and nothing is asked of them, including a report or a PR for them to look at: run \`wintos done\`, then stop.
Your pane shows one line on what you are doing: run \`wintos status "<one line, e.g. walking the test plan on #352>"\` when you start on this prompt and whenever the plan changes, and before you stop.
When your instructions give the work a process with named steps (a lane, a checklist), run \`wintos lane <name> <step>…\` once you know it (prefix a step that is the developer's call with ?), then \`wintos step <step> [note]\` each time you move to the next one. When a step turns into several things to do (the test path found three issues), list them with \`wintos todo <to-do>…\` and tick each with \`wintos todo done <to-do>\` as it lands. Your \`gh pr\` commands tell WintOS which PRs are yours; for a PR you work on without one (in the browser, through \`gh api\`), run \`wintos pr <link|owner/repo#n>\`.`;

// The text a UserPromptSubmit hook adds to Claude's context. It is re-sent on every prompt so
// the project survives /compact, and mine.md edits made mid-session are seen on the next one.
export function injection(project: Project | undefined, mine: { text: string; diff?: string }): string {
    const parts: string[] = [];
    if (mine.diff) parts.push(`mine.md changed since your last prompt:\n${mine.diff}`);
    if (project?.error) {
        parts.push(
            `[WintOS] ${join(project.dir, "project.md")} is unreadable (${project.error}). Restore its front matter (a \`---\` fenced block starting with \`id: ${project.id ?? "<tab id>"}\`) before anything else; keep the body.`
        );
        return parts.join("\n\n");
    }
    if (!project || !project.title) {
        parts.push(
            'This WintOS project has no title yet. Run `wintos title "<3-6 words naming the work>"` now. It creates the project folder and names the tab.',
            WAIT_RULE
        );
        return parts.join("\n\n");
    }
    const file = join(project.dir, "project.md");
    parts.push(`[WintOS project: ${file}]
This file is the durable picture of this project. Keep it true as understanding moves:
rewrite it when a decision is made, a belief is corrected, or the next action changes.
Do not rewrite it when nothing changed.
- Front matter: keep the first lines \`id: ${project.id}\` and \`title: ${project.title}\` exactly
  as they are (the id ties the file to its tab; rename with \`wintos title\`). \`next:\` is
  the single concrete action that moves this forward now. \`pr:\` lists this project's pull
  requests, comma-separated, added the moment you open or learn of one.
- Body sections, in order, in these exact formats (every session in this project reads them):
  ## Goal: two sentences on what this work is for.
  ## Decisions: dated bullets, newest last, e.g. \`- 19 sep — Confidence is scored per page.\`
  ## Open questions: one bullet each; end the one blocking progress with \`(blocking)\`.
  Use \`backticks\` for code. Under ~40 lines; replace, don't append.
- mine.md is the developer's. Read it, never write it. It outranks your own conclusions.`);
    parts.push(WAIT_RULE);
    parts.push(`mine.md:\n${mine.text}`);
    parts.push(`project.md:\n${project.error ? `(unreadable: ${project.error})` : project.body ?? ""}`);
    return parts.join("\n\n");
}
