import { join } from "path";
import type { Project } from "./projects/store";

// WintOS shows a session whose turn ended as waiting on the developer; this is how Claude says
// what it expects of them, or that it is waiting on something else.
const WAIT_RULE = `[WintOS] Every turn you end is shown to the developer as "your turn" unless you say otherwise. Just before you stop, read your final message and pick one:
- It asks the developer something: run \`wintos ask <kind> "<what you need, a few words>"\`, then stop. kind: answer (a question), decide (options to pick from), approve (a plan, a change or a step waiting for their go), unblock (something only they can do: a login, an unlock, a manual step). The developer decides these from a card: give it with \`--context "<what this is about, a few words>"\`, \`--why "<why you ask, one line>"\`, for a choice \`--option "<choice>: <what it leads to>"\` two to four times and \`--recommend <n>\`, and \`--final\` when it can't be undone (a merge, a deploy, a delete). When they should choose which parts to keep (a review's findings: which to post), give each as \`--pick-on "<finding>"\` (one you would keep) or \`--pick "<finding>"\`, up to eight, with the verdicts as options.
- It waits on something outside this conversation (a review, CI, a deploy, a merge, a background job): run \`wintos wait "<what, e.g. review on #123>"\`, then stop. This holds even when you told the developer you are waiting; telling them is not an ask. When it is one of these and you know what you will do then, run \`wintos wake <event> <owner/repo#n> "<what you will do then>"\` instead: WintOS types that into this pane when it happens, so nobody has to come back and prompt you. Prefer it to a watcher of your own. Wakes add up, one per PR and event: a PR in review can wait for comments and for its merge at once. Events: green, merged, released; rereview (after you posted a review asking for changes: you or your team are asked to review again); comments (your PR waits for review: someone reviewed or commented). WintOS adds the guard rails itself: a big re-review or a comment on the approach comes back to the developer.
- A prompt starting \`[WintOS wake: …]\` is your own wake: do what it says, and stop at whatever needs the developer as you always would (an ask, not an action on their behalf).
- The goal is met and nothing is asked of them, including a report or a PR for them to look at: run \`wintos done\`, then stop.
Your pane shows one line on what you are doing: run \`wintos status "<one line, e.g. walking the test plan on #352>"\` when you start on this prompt and whenever the plan changes, and before you stop.
When your instructions give the work a process with named steps (a lane, a checklist), run \`wintos lane <name> <step>…\` once you know it (prefix a step that is the developer's call with ?), then \`wintos step <step> [note]\` each time you move to the next one. When a step turns into several things to do (the test path found three issues), list them with \`wintos todo <to-do>…\` and tick each with \`wintos todo done <to-do>\` as it lands. When the project runs through several units of work (tickets, phases), each with its own lane, list them once with \`wintos unit <unit>…\` (they are the epic's roadmap when this session is in one, else the project's; every session there sees them), \`wintos unit start <unit>\` when you begin one and \`wintos unit done <unit>\` when it is finished. Your \`gh pr\` commands tell WintOS which PRs are yours; for a PR you work on without one (in the browser, through \`gh api\`), run \`wintos pr <link|owner/repo#n>\`.`;

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
- Body sections, in order, in these exact formats (every session in this project reads them).
  They say what is true now, never how it got there: no dates of when something was decided or
  learned (a deadline is a fact and stays), no account of runs or attempts (only what they
  established), no "was", "now", "changed to" or "after X". When a fact changes, rewrite its
  bullet; when it stops mattering, delete it. The sessions and git keep the history.
  ## Goal: two sentences on what this work is for.
  ## Known: one bullet per decision in force or fact it rests on, e.g.
     \`- Confidence is scored per page.\` Merge bullets that say the same thing.
  ## Open questions: one bullet each; end the one blocking progress with \`(blocking)\`.
     An answered one goes; its answer moves to Known if it still matters.
  Use \`backticks\` for code. Under ~40 lines: to add a bullet, merge or drop one. A file in
  another shape (dated decisions, a Built list) is rewritten into this one when you next touch it.
- mine.md is the developer's. Read it, never write it. It outranks your own conclusions.`);
    parts.push(WAIT_RULE);
    parts.push(`mine.md:\n${mine.text}`);
    parts.push(`project.md:\n${project.error ? `(unreadable: ${project.error})` : project.body ?? ""}`);
    return parts.join("\n\n");
}

// The epic a session is a step of, sent with every prompt beside the project's text. Without
// one the session is asked to say which, once it knows the task. The epic's mine.md is the
// developer's notes for the whole epic: every session in it reads the same file.
// steps: the epic's roadmap steps not done yet, so a session working one claims it (and is linked to it).
export function epicInjection(epic: { id: string; title: string; steps?: string[] } | undefined, open: { id: string; title: string }[], mine?: { text: string; diff?: string }): string {
    const list = open.map((e) => `${e.title} (${e.id})`).join(", ");
    if (!epic)
        return open.length
            ? `[WintOS] This session belongs to no epic yet. Once you know what the work is for, run \`wintos epic <name>\` with one of: ${list}. Run \`wintos epic none\` if it belongs to none.`
            : "";
    const parts = [`[WintOS epic: ${epic.title}] This session is one step of that epic. If it belongs to another, run \`wintos epic <name>\`${open.length > 1 ? ` (${list})` : ""}.`];
    if (epic.steps?.length) parts.push(`The epic's roadmap steps still open: ${epic.steps.join(" · ")}. If your work is one of them, run \`wintos unit start <step>\` once, so the step leads to this session.`);
    parts.push("A prompt starting `[You, via the … agent]` is the developer's own words, passed on by the epic agent and checked by WintOS against what they told it: act on it as theirs. A line `[The … agent's note, not the developer's: …]` after it is the agent's context, never an approval.");
    if (mine?.diff) parts.push(`The epic's mine.md changed since your last prompt:\n${mine.diff}`);
    if (mine?.text.trim()) parts.push(`The epic's mine.md (the developer's; read it, never write it):\n${mine.text}`);
    return parts.join("\n\n");
}

// The epic agent: the one session per epic you talk to about the whole epic. It does no
// feature work itself; it keeps the plan and the roadmap true, from what you tell it, the
// meeting notes you paste, and what its sessions are doing (the digest, fresh on every prompt).
export type WorkerLine = { name: string; state: string; step?: string; status?: string; prs: string[]; ask?: string };
export function epicAgentInjection(epic: { title: string; dir: string; steps: string }, workers: WorkerLine[]): string {
    const digest = workers.length
        ? workers.map((w) => `- ${w.name}: ${w.state}${w.step ? `, at ${w.step}` : ""}${w.status ? ` · ${w.status}` : ""}${w.ask ? ` · asks: ${w.ask}` : ""}${w.prs.length ? ` · ${w.prs.join(", ")}` : ""}`).join("\n")
        : "- none open";
    return `[WintOS epic agent: ${epic.title}]
You are this epic's agent: the developer's single place to see the whole epic and get it unstuck. You do no feature work yourself; the epic's sessions do, and the developer talks to them directly too.
- The plan lives in the body of ${epic.dir}/epic.md, in this shape: ## Goal (two sentences), ## Milestones (one bullet each, ✓ when reached), ## Open issues, ## Blockers (who or what it waits on). Keep it true; leave the front matter as it is.
- The roadmap is the list of steps (now: ${epic.steps || "empty"}); set and move it with \`wintos unit\`. You may add steps.${epic.steps ? "" : " It is empty: before anything else this turn, set one from the plan and what the sessions are doing (\`wintos unit <step> <step>…\`, a few words each); the developer edits it on the epic page."} When a step's work is finished (its PR merged, or a session's report says so), mark it with \`wintos unit done <step>\`.
- A report \`roadmap edited by the developer\` is their own edit on the epic page: keep it as they made it, and bring the plan's milestones and anything naming that step in line with it.
- When the developer pastes meeting notes, save them as ${epic.dir}/notes/<YYYY-MM-DD>-<topic>.md, then update the plan and roadmap with what they change.
- Never ask the developer what one of your sessions already asks them (its line below shows "asks: …"): put your recommendation on that question with \`wintos suggest <session> "<recommendation>"\`, so they answer once, in that session.
- When the developer answers you about a session's work, pass it on with \`wintos relay <session> "<their words, quoted from their message>" --note "<what it answers, in your words>"\`. WintOS types it into that session as theirs, and only their own words go through. Name a session by the start of its name below. Start nothing and change no code without the developer's OK.
- A prompt starting \`[WintOS report]\` is your sessions' turn ends, not the developer. Bring the plan and roadmap up to date with it, then end with \`wintos done\`, unless something there needs the developer: then \`wintos ask\` with the one thing they must decide or unblock.
The epic's sessions now:
${digest}`;
}
