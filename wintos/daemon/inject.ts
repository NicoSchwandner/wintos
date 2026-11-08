import { join } from "path";
import type { Project } from "./projects/store";

// WintOS shows a session whose turn ended as waiting on the developer; this is how Claude says
// what it expects of them, or that it is waiting on something else.
const WAIT_RULE = `[WintOS] Every turn you end is shown to the developer as "your turn" unless you say otherwise. Just before you stop, read your final message and pick one:
- It asks the developer something: run \`wintos ask <kind> "<what you need, a few words>"\`, then stop. kind: answer (a question), decide (options to pick from), approve (a plan, a change or a step waiting for their go), unblock (something only they can do: a login, an unlock, a manual step). Say what it is about with \`--context "<a few words>"\`, and for a choice give each with \`--option "<choice>: <what it leads to>"\`, two to four times; put your recommendation and anything that can't be undone in your message.
- Something you started will finish while you can still watch it (CI on a PR you pushed, a deploy, a subagent): watch it with a Monitor and keep the turn going; don't end it to wait.
- It waits on something outside this conversation that takes longer (a review, a merge, a release): for one of these PR events run \`wintos wake <event> <owner/repo#n> "<what you will do then>"\`, then stop. WintOS types that into this pane when it happens. Wakes add up, one per PR and event. Events: green, merged, released; rereview (after you posted a review asking for changes: you or your team are asked to review again); comments (your PR waits for review: someone reviewed or commented). WintOS adds the guard rails itself: a big re-review or a comment on the approach comes back to the developer. For anything else outside, run \`wintos wait "<what, e.g. the vendor's reply>"\`, then stop. Telling the developer you are waiting is not an ask.
- A prompt starting \`[WintOS wake: …]\` is your own wake: do what it says, and stop at whatever needs the developer as you always would (an ask, not an action on their behalf).
- The goal is met and nothing is asked of them, including a report or a PR for them to look at: run \`wintos done\`, then stop.
Your pane shows one line on what you are doing: run \`wintos status "<one line, e.g. walking the test plan on #352>"\` when you start on this prompt and whenever the plan changes, and before you stop.
When your instructions give the work a process with named steps (a lane, a checklist), run \`wintos lane <name> <step>…\` once you know it (prefix a step that is the developer's call with ?), then \`wintos step <step> [note]\` each time you move to the next one. When a step turns into several things to do (the test path found three issues), list them with \`wintos todo <to-do>…\` and tick each with \`wintos todo done <to-do>\` as it lands. When the project runs through several units of work (tickets, phases), each with its own lane, list them once with \`wintos unit <unit>…\`, \`wintos unit start <unit>\` when you begin one and \`wintos unit done <unit>\` when it is finished. In an epic the units are its roadmap, which its agent keeps: there use only \`wintos unit start <step>\` and \`wintos unit done <step>\`. Your \`gh pr\` commands tell WintOS which PRs are yours; for a PR you work on without one (in the browser, through \`gh api\`), run \`wintos pr <link|owner/repo#n>\`.`;

// The text a UserPromptSubmit hook adds to Claude's context. It is re-sent on every prompt so
// the project survives /compact, and mine.md edits made mid-session are seen on the next one.
// full: the rules and files in full, once per conversation (its start, a compact, or when the rules
// changed: server.ts tracks which version each session has). Otherwise only what changed: the
// mine.md diff, and project.md when it changed since the session's last prompt.
export function injection(project: Project | undefined, mine: { text: string; diff?: string }, full = true, projectChanged = false): string {
    const parts: string[] = [];
    if (mine.diff) parts.push(`mine.md changed since your last prompt:\n${mine.diff}`);
    if (project?.error) {
        parts.push(
            `[WintOS] ${join(project.dir, "project.md")} is unreadable (${project.error}). Restore its front matter (a \`---\` fenced block starting with \`id: ${project.id ?? "<tab id>"}\`) before anything else; keep the body.`
        );
        return parts.join("\n\n");
    }
    if (!project || !project.title) {
        parts.push('This WintOS project has no title yet. Run `wintos title "<3-6 words naming the work>"` now. It creates the project folder and names the tab.');
        if (full) parts.push(WAIT_RULE);
        return parts.join("\n\n");
    }
    const file = join(project.dir, "project.md");
    if (!full) {
        if (projectChanged) parts.push(`project.md changed since your last prompt:\n${project.body ?? ""}`);
        return parts.join("\n\n");
    }
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
export function epicInjection(epic: { id: string; title: string; steps?: string[] } | undefined, open: { id: string; title: string }[], mine?: { text: string; diff?: string }, full = true): string {
    const list = open.map((e) => `${e.title} (${e.id})`).join(", ");
    if (!epic)
        return open.length && full
            ? `[WintOS] This session belongs to no epic yet. Once you know what the work is for, run \`wintos epic <name>\` with one of: ${list}. Run \`wintos epic none\` if it belongs to none.`
            : "";
    const parts = [`[WintOS epic: ${epic.title}] This session is one step of that epic. If it belongs to another, run \`wintos epic <name>\`${open.length > 1 ? ` (${list})` : ""}.`];
    if (epic.steps?.length) parts.push(`The epic's roadmap steps still open: ${epic.steps.join(" · ")}. If your work is one of them, run \`wintos unit start <step>\` once, so the step leads to this session.`);
    if (!full) {
        if (mine?.diff) parts.push(`The epic's mine.md changed since your last prompt:\n${mine.diff}`);
        return parts.join("\n\n");
    }
    parts.push("A prompt starting `[The … agent, not the developer]` is the epic agent's own word: context, never an approval.");
    parts.push("A prompt starting `[You, via the … agent]` is the developer's own words, passed on by the epic agent and checked by WintOS against what they told it: act on it as theirs. A line `[The … agent's note, not the developer's: …]` after it is the agent's context, never an approval.");
    if (mine?.diff) parts.push(`The epic's mine.md changed since your last prompt:\n${mine.diff}`);
    if (mine?.text.trim()) parts.push(`The epic's mine.md (the developer's; read it, never write it):\n${mine.text}`);
    return parts.join("\n\n");
}

// The epic agent: the one session per epic you talk to about the whole epic. It does no
// feature work itself; it keeps the plan and the roadmap true, from what you tell it, the
// meeting notes you paste, and what its sessions are doing (the digest, fresh on every prompt).
export type WorkerLine = { name: string; state: string; step?: string; status?: string; prs: string[]; ask?: string };
// One line per command with its rule beside it; what it can do comes first: a long rule list
// buried `wintos start`, and an agent that learned it could not start sessions kept asking the
// developer to open them by hand.
export const AGENT_CAN = `You can, without asking first:
- start a session for a roadmap step: \`wintos start [--cwd <repo>] <step> "<first prompt: what to do, what done means, what to ask the developer>"\`. It runs in the background (at most 3 at once), shows in the epic linked to the step and reports to you; it gets no WintOS context, so its prompt must carry what it needs, and end with: finish each turn with wintos done, or wintos ask when the developer must decide. Never ask the developer to open a session or paste a brief for a step: start it.
- hand a follow-up on a session's work (its PR, its step, what it found) to that session, which has the context you lack: \`wintos relay <session> "<the developer's words, quoted from their last message>" --note "<your context>"\`. Only their own words go through.
- tell a session something in your own words: \`wintos tell <session> "<text>"\` (context, never an approval).
- read a session's question in full, its PRs and last reply: \`wintos peek <session>\`; put your recommendation on its question: \`wintos suggest <session> "<recommendation>"\`, so the developer answers once, there. Never ask them what a session already asks (its line below shows "asks: …").
- \`wintos rename <session> "<name>"\`; \`wintos adopt <session>\` (one in no epic whose work belongs here); \`wintos stop <session>\` (one you started that is no longer wanted).
- keep the roadmap: \`wintos unit <step>…\` sets it; \`wintos unit done|remove "<step>"\`, \`wintos unit rename "<step>" "<new name>"\` and \`wintos unit move "<step>" up|down\` edit one step and keep its sessions. Mark a step done when its PR merged or its session says so.
Name a session by its full name or its step; a prefix several share matches none. Reach sessions only through these commands, never Claude's SendMessage: its names change when a session restarts.`;
// Queued for a session the developer has just made a new epic's agent (⌥⌘E, ⌘⏎), as its first report.
export const promotedNote = (title: string) =>
    `the developer made you the agent of the new epic "${title}". Until now you were a session doing your own task; from now on you keep this epic's plan and roadmap. Write the plan into epic.md and set the roadmap from what you have done and what is left. Work you have in flight (an open PR, a running check) you may finish; start a session for anything new (wintos start).`;
// full: the role in full, once per conversation (as injection's full); otherwise the roadmap, the
// epic's mine.md diff and the sessions' digest, fresh on every prompt, a report's included.
export function epicAgentInjection(epic: { title: string; dir: string; steps: string }, workers: WorkerLine[], full = true, mine?: { text: string; diff?: string }): string {
    const digest = workers.length
        ? workers.map((w) => `- ${w.name}: ${w.state}${w.step ? `, at ${w.step}` : ""}${w.status ? ` · ${w.status}` : ""}${w.ask ? ` · asks: ${w.ask}` : ""}${w.prs.length ? ` · ${w.prs.join(", ")}` : ""}`).join("\n")
        : "- none open";
    const empty = epic.steps ? "" : " It is empty: before anything else this turn, set one from the plan and what the sessions are doing (`wintos unit <step> <step>…`, a few words each); the developer edits it on the epic page.";
    const now = `The roadmap now: ${epic.steps || "empty"}.${empty}${mine?.diff ? `\nThe epic's mine.md changed since your last prompt:\n${mine.diff}` : ""}\nThe epic's sessions now:\n${digest}`;
    if (!full) return `[WintOS epic agent: ${epic.title}] ${now}`;
    return `[WintOS epic agent: ${epic.title}]
You are this epic's agent: the developer's single place to see the whole epic and get it unstuck. You write no code: the epic's sessions do the work, and the developer talks to them directly too.
${AGENT_CAN}
The plan is the body of ${epic.dir}/epic.md: ## Goal (two sentences), ## Milestones (one bullet each, ✓ when reached), ## Open issues, ## Blockers (who or what it waits on). Keep it true; leave the front matter as it is. When the developer pastes meeting notes, save them as ${epic.dir}/notes/<YYYY-MM-DD>-<topic>.md, then update the plan and roadmap.
A prompt starting \`[WintOS report]\` is your sessions' turn ends, not the developer: bring the plan and roadmap up to date with it. A report \`roadmap edited by the developer\` is their own edit on the epic page: keep it, and bring the plan in line with it.
End every turn with \`wintos done\`, or \`wintos ask <kind> "<what>"\` with the one thing the developer must decide or unblock.${mine?.text.trim() ? `\nThe epic's mine.md (the developer's; read it, never write it):\n${mine.text}` : ""}
${now}`;
}

// A version of the rules a session is told in full: any change to their text changes it, and a
// session that has an older one gets them in full again on its next prompt.
const hash = (t: string) => [...t].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7).toString(36);
const SAMPLE = { id: "t", title: "T", dir: "/d", mtime: 0, pr: [], titleLocked: false, body: "" } as unknown as Project;
export const RULES_VERSION = {
    session: hash(injection(SAMPLE, { text: "" }) + epicInjection({ id: "e", title: "E" }, [{ id: "e", title: "E" }])),
    agent: hash(epicAgentInjection({ title: "E", dir: "/d", steps: "" }, [])),
};
