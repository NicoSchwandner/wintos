# Herdr Companion Implementation Plan

> **For agentic workers:** follow the executing-plans method to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Keep event wakes and PR-session continuity in Herdr with international-keyboard navigation.
**Architecture:** A user-owned local background companion indexes Herdr hook events and reads WintOS history without writing it. It checks only registered wakes; no PR-queue plugin or fixer. A small always-loaded command mod handles navigation; a separate search dialog follows the shipped picker. Install into a persistent local app-data directory with launchd, independently of the window.
**Tech Stack:** Node, TypeScript, existing esbuild/vitest, gpui-kit.
**Spec:** User's approved proposals in this conversation: attention-only Ctrl-Tab, bracket-free navigation, independent event wakes, search/resume by PR including archived WintOS sessions. Epics are deferred.

## Global Constraints
- Preserve WintOS runtime and data. Read-only access to its history; no second fixer or whole PR fetch.
- Keep Herdr's shipped sidebar and layout. Only add a tiny command block and search dialog.
- Ctrl-Tab/Shift-Ctrl-Tab cycle blocked/done agents; working/idle excluded; no eligible agent means no movement.
- Cmd-J/K cycle all agents; Cmd-Up/Down switch spaces; Shift-Cmd-G searches PR/session history.
- Exact Actions run: completion success triggers success; failure/cancellation reports failure, never success. Pending runs and API errors remain pending. Persist wakes across service restarts.
- Keep conversations bound to terminal and Claude config directory. Never resume a running conversation twice; never send to a shell or unrelated conversation.
- UI composition uses Herdr picker patterns and theme tokens. No extra packages.

## Verification
- [ ] Navigation tests exercise the actual command mod with synthetic agents, including reverse/wrap, current done becoming idle, and none eligible.
- [ ] Companion tests exercise hook registration, PR matching/deduplication across live and shelved history, terminal focus versus resume, wake checking/delivery, failures, pending, retries and persistence.
- [ ] Installer test operates in a temporary app home, backs up keys, is repeatable, retains unrelated bindings/mods, and adds no fixer.
- [ ] Hook/CLI test invokes real scripts with a fake local service, preserving Wave behaviour.
- [ ] Build bundles; typecheck; WintOS suite; herdr-app checks; live shortcut/search check and synthetic wake delivery to an isolated fixture terminal.

## Tasks
### 1: Companion service and session index
Files: wintos/herdr/{companion.ts,companion.test.ts,main.ts}.
- [ ] RED: test session registration/search, safe opening, persisted PR and Actions-run wakes through the service boundary.
- [ ] GREEN: implement HTTP API and CLI entry point; reuse prNow/reached; read WintOS sessions/shelf read-only, supplement PR queries from transcripts.
- [ ] Verify pending/error/failed/success run handling and delivery targeting before proceeding.
### 2: Herdr keyboard commands and search dialog
Files: wintos/herdr/mods/{wintos-nav,wintos-search}/*, navigation tests.
- [ ] RED: execute actual mod against stubbed host and inspect command effects.
- [ ] GREEN: command loop, attention queue, search input and selectable rows, open button and Enter, errors and empty state.
- [ ] Check native renders and actual layout.
### 3: Hook, CLI, installer and background lifecycle
Files: wintos/herdr/{hook.sh,install.mjs,install.test.ts}, wintos/cli/wintos.
- [ ] RED: hook forwards Herdr events only; CLI routes Herdr wakes; installer updates isolated config without removing existing preferences.
- [ ] GREEN: build/install persistent bundles and launch agent, add hooks preserving existing config, install tiny hidden block into cloned personal layout.
- [ ] Review tests, build and install locally; verify with runnable checks.

## Review Focus
- A reused terminal must never receive a wake belonging to an older conversation.
- A busy live WintOS session must never be resumed concurrently in Herdr.
- A failed run cannot produce a success prompt, including reruns.
- A failed send or GitHub request must preserve the pending wake.
- Removal or repeated installation must preserve unrelated Herdr customization.

## State
Plan approved through user prompt. Base origin/key-router (the WintOS development branch); origin/main is upstream Wave.
