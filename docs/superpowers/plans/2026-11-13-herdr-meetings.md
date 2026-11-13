# Herdr Sidebar Glances Implementation Plan

> **For agentic workers:** follow the subagent-driven-development method to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Show up to two meetings for today with their rooms beneath Herdr's clock, and whole-machine CPU/RAM usage at the bottom left.
**Architecture:** The existing companion reads the same private calendar configuration and room mapping as WintOS. It reuses the existing ICS parser and exposes only meeting display data. A native sidebar mod follows Herdr's theme and leaves the clock intact.
**Tech Stack:** Existing Node/TypeScript, esbuild, Vitest, ICS parser and gpui-kit; no new dependency.
**Spec:** The approved meeting view shows only today: the first meeting has time, name and room; the second is a single “Then <start time> · <name> · <room>” line. Neither entry shows a date. Long second-entry names truncate while time and room remain visible. The first layout preview was approved before enabling the today filter. CPU/RAM remains at bottom left; no join functionality.

## Global Constraints
- Do not start, restart or write to the everyday WintOS instance.
- Keep the private calendar address in memory only; never log, return or persist it.
- Use the configured room mapping and existing ICS parser. No new account setup.
- Both rooms remain visible; long titles cannot crowd them out. The first room has its own line, and the second stays on the single Then line.
- No join control or browser action. Preserve the existing clock and selected layout.
- Automated tests use synthetic calendars and mocked network/configuration only.
- Resource monitoring must be lightweight: CPU counter deltas and native VM counters, not repeated process listings or `top` runs.

## Review Focus
- A calendar outage must be distinguishable from an empty calendar; retain the last successful display with a stale indicator.
- Concurrent refreshes must share one fetch; a missing calendar setting must not expose configuration text.
- Current, imminent and overlapping meetings must have deterministic ordering; tomorrow and later never fill an empty slot. An ongoing overnight meeting remains visible.
- Missing rooms must say so explicitly, rather than inventing an online location.
- Reinstallation and layout changes must retain the clock and place the card directly below it.

## Interfaces
```ts
type CalendarMeeting = {title: string; start: string; end: string; room?: string; reply?: "pending" | "tentative"};
type CalendarView = {meetings: CalendarMeeting[]; updatedAt?: number; error?: string};
// backend/calendar.ts: lazy, cached; defaults load existing private config only on read.
createCalendarFeed(options?: {loadSettings?: () => {url?: string; rooms?: string[]}; fetch?: typeof fetch; now?: () => number}): {read(): Promise<CalendarView>};
// meetings.ts: browser-neutral display model, bundled as the mod's model.js.
meetingRows(data: CalendarView, now: number): {title: string; time: string; room: string; unaccepted?: boolean}[];
type SystemView = {cpu?: number; memory?: {used: number; total: number}; error?: string};
createSystemSampler(options?: {cpus?: () => import("node:os").CpuInfo[]; totalmem?: () => number; vmStat?: () => Promise<string>; now?: () => number}): {read(): Promise<SystemView>};
```

### Task 1: Calendar feed
Files: `wintos/herdr/backend/calendar.ts`, `wintos/herdr/calendar.test.ts`.
- [x] Write failing tests for mapped room data, no returned call links, cache/concurrency, empty/malformed feeds, missing configuration and stale-on-error behavior.
- [x] Implement `createCalendarFeed`; default settings reader allowlists calendar/room assignments, uses literal env parsing, and never executes shell text. Reuse the shared strict calendar parser with a 14-day feed window and a 60-second cache. The view selects today only.
- [x] Run `npx vitest run wintos/herdr/calendar.test.ts --configLoader runner`; ensure failures become green without real network calls.

### Task 2: Native card
Files: `wintos/herdr/meetings.ts`, `wintos/herdr/meetings.test.ts`, `wintos/herdr/mods/wintos-meetings/{main.js,mod.json}`.
- [x] Write failing model and actual-mod wiring tests. Example: a long title with `room: "Room North"` must retain that room in the first row and return at most two rows.
- [x] Reuse WintOS meeting normalization/selection for current versus imminent meetings; show only current/remaining meetings today and never fill slots from tomorrow or later. Show explicit missing-room text.
- [x] Fetch `/meetings` on initialization and once per minute; render a primary meeting and one compact Then line, with an error/stale state. Healthy two/one/empty states use 74/54/28 px; an error above retained meetings adds 18 px. Resize its own slot for empty/one/two rows. No join actions.
- [x] Run the scoped tests with mocked fetch/host APIs. Do not commit generated `model.js`.

### Task 3: Wire and verify
Files: `wintos/herdr/companion.ts`, `companion.test.ts`, `install.mjs`, `install.test.ts`.
- [x] Add caller-level tests for GET `/meetings` and for installation directly after an existing `local-clock` slot without changing that slot.
- [x] Add the lazy calendar reader to the companion's protected GET routing. Copy the new mod and bundle `meetings.ts` to its `model.js`; insert its block beneath the clock.
- [x] Run scoped tests, full suite, typecheck and native checks. Install locally and inspect actual meeting rooms without printing or committing calendar content.
- [x] Fresh independent review completed with no findings after the calendar fixes. Deliver a stacked PR through create-pr. Base is the event-companion branch, incorporating its final race fixes before integration.

### Task 4: Whole-machine resources
Files: `wintos/herdr/backend/system.ts`, `wintos/herdr/system.test.ts`, `wintos/herdr/mods/wintos-system/{main.js,mod.json}`; main wires protected GET `/system` and installation above the sidebar footer.
- [x] Write failing synthetic tests for CPU delta percentages, the first sample, zero/regressing counters, shared five-second cache, native memory counters and command failure.
- [x] Implement CPU busy percentage from aggregate `os.cpus()` deltas. Read macOS `vm_stat` page counts and total RAM; used memory excludes reclaimable file cache and counts compressed physical pages once. Never run a process listing.
- [x] Render `CPU 42% · RAM 12.0/48 GiB` using native theme text, refreshing every five seconds. Unknown values remain unknown rather than becoming zero.
- [x] Test actual mod fetch/render wiring with mocked host/network; add installation tests for its bottom-left slot. Run scoped/full tests, typecheck and populated native-render checks with the meeting card.

## Verification state
All 1,530 tests and full typecheck pass. Tests cover the approved compact layout, today-only selection, no future-day fallback, midnight rollover, ongoing overnight events, room visibility and empty-state copy. Populated native checks use two meetings today plus a hidden tomorrow meeting. Live screenshots verify the approved populated Then layout, readable room names and CPU/RAM, and the today-only empty state; no screenshot is committed because unrelated terminal text is private.
