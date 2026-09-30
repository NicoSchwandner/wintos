import { join } from "path";
import type { Project } from "./projects/store";

// WintOS shows a session whose turn ended as waiting on the developer; this is how Claude says
// it is waiting on something else instead.
const WAIT_RULE = `[WintOS] Every turn you end is shown to the developer as "your turn" unless you say otherwise. Just before you stop, read your final message and pick one:
- It asks the developer something (a question, a decision, a step for them): stop as usual.
- It waits on something outside this conversation (a review, CI, a deploy, a merge, a background job): run \`wintos wait "<what, e.g. review on #123>"\`, then stop. This holds even when you told the developer you are waiting; telling them is not an ask.
- The goal is met and nothing is asked of them: run \`wintos done\`, then stop.`;

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
- Body sections, in order, in these exact formats (the WintOS notes view renders them):
  ## Goal: two sentences on what this work is for.
  ## Decisions: dated bullets, newest last, e.g. \`- 19 sep — Confidence is scored per page.\`
  ## Built: \`- [x]\` done, \`- [~]\` partial, \`- [ ]\` todo.
  ## Open questions: one bullet each; end the one blocking progress with \`(blocking)\`.
  Use \`backticks\` for code. Under ~40 lines; replace, don't append.
- mine.md is the developer's. Read it, never write it. It outranks your own conclusions.`);
    parts.push(WAIT_RULE);
    parts.push(`mine.md:\n${mine.text}`);
    parts.push(`project.md:\n${project.error ? `(unreadable: ${project.error})` : project.body ?? ""}`);
    return parts.join("\n\n");
}
