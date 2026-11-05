# WintOS backlog

Open work, most important first. Each item says why it matters and where to start. Remove an item
in the commit that finishes it.

## Next

### "Needs you" reasons that resolve themselves

A session needs you while it has at least one open reason (a question, an approval, a wake). A
reason knows what it is about (a PR, a roadmap step, another session's reason) and closes by itself:
you prompt its session, a linked reason closes, or its subject settles it (the PR merges, CI goes
green, the step is marked done). The same question asked again matches the open reason instead of
adding one.

Why: today a session has one `ask`, so the epic agent and its session can wait on you for the
same thing. `wintos relay` and `wintos suggest` removed most of that. This removes the rest.

Start: first read a few days of `.events/<day>.jsonl` (in the projects root). Count the turns
where you answered both an agent and one of its sessions about the same thing, and the reasons
that stayed open after their PR merged. Build only the resolving rules the log shows are needed.
Touches `daemon/sessions/reduce.ts` (reasons replace `ask`), `daemon/ranking/rank.ts`,
`wintos ask --about`, and the agent instructions in `daemon/inject.ts`.

### One header per pane

Three bands sit over a pane today: the epic strip, the view's title row and the session header.
The epic and session names show two or three times, and clicking them does different things.
Merge them into one band: the epic's face and name once, the session's name once, its state in
the sidebar's words, and one reason line ("Your move: it asks …", "Quiet: paused on CI") that
says why the session sits where it does.

Start: `ui/EpicStrip.tsx`, `ui/PaneStrip.tsx`, `ui/SessionHeader.tsx`.

### Retire "project" from the UI, and project.md for sessions in an epic

With epics, the project (a tab) is close to vestigial, but it still names things ("Close tab",
"Open project", "a view of its own"), drives ⌘R with no session focused and ⇧⌘W, and keeps
project.md. A view should be a layout of sessions and nothing more.

Sessions in an epic still write `next:` lines into the project.md of the project they run in, so
the plan lives in two places that drift apart. Sessions in an epic should stop writing project.md,
and an old project.md's content should move into its epic.

Start after the reasons queue. Look at `daemon/inject.ts` (what a session is told to write) and
`daemon/projects/` (where project.md is read).

## Known gaps

- **The epic column needs a 700px pane.** Beside a narrower pane (a split), the agent's view has
  no epic. Possible fix: lower the threshold, or switch to a slimmer layout. See `.wintos-steps-side`
  in `ui/theme.css`.
- **Merged PRs on open projects.** Only closed projects put a merged or released PR in To read. An
  open project's waking row still sits in Your move until the wake is typed in (`waking()` in
  `ui/attention.ts`).
- **A session the agent starts in the background gets no WintOS context** (its hooks never reach
  WintOS: the background service drops the pane's ids), so the agent's first prompt has to carry
  it, and its state comes from polling `claude agents --json` every 15 seconds.
- **The relay needs your last prompt in memory.** After a daemon restart, a relay is refused
  until you say something to the agent again (`lastSaid` in `daemon/api/server.ts`).
- **Claude's peer names don't match WintOS names.** Claude lists sessions as `work-xx`, so a
  session's own SendMessage can't find another session by its WintOS name. The relay goes around
  this; nothing maps the two names yet.
- **Meeting hours need a calendar.** The month report counts meetings only when
  `WINTOS_CALENDAR_ICS` is set.

## Tests

- **Closed-project wakes have no e2e check.** No e2e step can create a due wake on a closed
  project, so the To read placement is covered by `ui/wakes.test.ts` only.
- **e2e scenarios 2, 3 and 30 need live GitHub** (pages, or real PR rows in the PRs tab) and fail
  on the dev instance.
- **Scenario 37 depends on order:** it passes alone and failed once in a 20–50 run.
- **A view opened during an e2e run has no size** while the dev window is covered, and
  `Page.captureScreenshot` hangs then. Scenarios that check layout work in an existing view (48
  uses T2).
- **Flaky under full-suite load:** the journal test and the heads-up dismiss test in
  `daemon/api/server.test.ts`. Both pass on a rerun.

## Decided against

- **A "next up" queue across epics on the home.** Each epic's roadmap, with `d` to mark a step
  done, is enough.
- **Closing or shelving anything automatically.** Nothing in WintOS closes by itself.
