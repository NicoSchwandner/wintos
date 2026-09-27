import { join } from "path";
import type { Project } from "./projects/store";

// The text a UserPromptSubmit hook adds to Claude's context. It is re-sent on every prompt so
// the project survives /compact, and mine.md edits made mid-session are seen on the next one.
export function injection(project: Project | undefined, mine: { text: string; diff?: string }): string {
    const parts: string[] = [];
    if (mine.diff) parts.push(`mine.md changed since your last prompt:\n${mine.diff}`);
    if (!project || !project.title) {
        parts.push(
            'This WintOS project has no title yet. Run `wintos title "<3-6 words naming the work>"` now. It creates the project folder and names the tab.'
        );
        return parts.join("\n\n");
    }
    const file = join(project.dir, "project.md");
    parts.push(`[WintOS project: ${file}]
This file is the durable picture of this project. Keep it true as understanding moves:
rewrite it when a decision is made, a belief is corrected, or the next action changes.
Do not rewrite it when nothing changed.
- Front matter: keep \`id\` and \`title\` as they are (rename with \`wintos title\`). \`next:\` is
  the single concrete action that moves this forward now. \`pr:\` lists this project's pull
  requests, comma-separated, added the moment you open or learn of one.
- Body sections, in order: ## Goal (two sentences) · ## Decisions (dated bullets) · ## Built ·
  ## Open questions (mark the blocking one). Under ~40 lines; replace, don't append.
- mine.md is the developer's. Read it, never write it. It outranks your own conclusions.`);
    parts.push(`mine.md:\n${mine.text}`);
    parts.push(`project.md:\n${project.error ? `(unreadable: ${project.error})` : project.body ?? ""}`);
    return parts.join("\n\n");
}
