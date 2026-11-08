import { readJson, writeJsonAtomic } from "../persist";
import { execFile } from "child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch, writeFileSync, type FSWatcher } from "fs";
import { AsyncLocalStorage } from "async_hooks";
import http from "http";
import type { AddressInfo } from "net";
import { basename, dirname, join } from "path";
import { WebSocketServer, type WebSocket } from "ws";
import { epicAgentInjection, epicInjection, injection, promotedNote, RULES_VERSION } from "../inject";
import { EpicStore, EPIC_TITLE_MAX, findEpic, SHORT_MAX } from "../epics/epics";
import { moveEpic } from "../epics/order";
import { impliedEpic } from "../epics/assign";
import { addTime, adjustMonth, epicHistory, lastWorkdays, mergeBackfill, monthByEpic, type TimeLog } from "../epics/time";
import { lineDiff } from "../projects/diff";
import { workedFocus } from "../epics/worked";
import { icsToMeetings } from "../../plugins/calendar/parse";
import { meetingMs } from "../../plugins/calendar/hours";
import { lastReply as lastReplyIn, peekText, readTail } from "../epics/peek";
import { BG_ID, BG_MAX, liveStarts, mergeBg, parseAgents, pruneStarts, type BgAgent, type BgStarts } from "../epics/bgstart";
import { addRelay, relayPrompt, findWorker, relaysDelivered, youSaid, type Relays } from "../epics/relay";
import { editRoadmap, linkStep, mergedSteps, pruneLinks, type RoadmapOp } from "../epics/roadmap";
import { addReport, delivered as reportsDelivered, reportLine, worthReporting, type Reports } from "../epics/reports";
import { Plugin, PluginRunner } from "../plugins/runner";
import type { Snoozes } from "../prs/group";
import { ProjectStore } from "../projects/store";
import type { Journal } from "../journal/journal";
import { formatMarkdown } from "../markdown";
import { dayRecapper } from "../recap/day";
import { localDay, prFact, waitedFor } from "../recap/recap";
import { emptyStats, recordClick, recordDayDone, recordKey, type KeyStats } from "../keyboard/keyboard";
import { resumedSession, shelve, unshelve, withTitle, type Shelf, type Shelved } from "../shelf/shelf";
import { oneShot, titlePrompt, writeTitle } from "../shelf/title";
import { doneUnit, serializeUnits, setUnits, startUnit, unitIndex, UNIT_MAX, UNITS_MAX, type Unit } from "../projects/units";
import { fixJob, fixPrompt, nextAction, type FixJob } from "../fixer/plan";
import { reassignPrs, touchPrs } from "../prs/owners";
import { groupOf, type DonePr, type PR } from "../prs/group";
import { Fixer } from "../fixer/runner";
import { isWintosPrompt, namePrompt, nameKey, userPrompts } from "../sessions/naming";
import { finishSession, freshStatus, HookEvent, liveSubagents, parkSession, reduceSession, restoreSessions, Session, setEpic, setLane, setStatus, setStep, setTodo, tickTodo, endSessions, leavingFor, unparkSession, nameSession, renameSession, acceptSuggestedName, titleSession, liveIn, prLinks, askSession, readTurn, attachSession } from "../sessions/reduce";
import { askCard, askPrompt, guessAsk, isAskKind, parseAsk } from "../sessions/asks";
import { changes, trail } from "../sessions/trail";
import { eventLog } from "../events";
import { lastReply, reentry } from "../sessions/reentry";
import { AWAY_MS, prompted, snooze, startBreak, tick, type Rhythm } from "../rhythm/rhythm";
import { afterCheck, expiresAt, isWakeEvent, MAX_PROMPT, rekeyed, WAKE_EVENTS, waitingOn, wakeId, wakePrompt, type PrNow, type WakeEvent, type Wakes } from "../wakes/wakes";
import { prNow, type Who } from "../wakes/github";
import { fetchDone, unlisted } from "../prs/done";
import { DEFAULT_PORT } from "../../instance";
import { restart as restartWintos, updateWatch } from "../update/update";
import { capture, dismiss, readStore, STORE_PREFIX, watchHealth, type Health, type HeadsUp } from "../headsups/headsups";

export type WintosServer = { http: http.Server; close: () => void };

// The WintOS renderer in dev. A packaged build adds its own origin via WINTOS_UI_ORIGINS.
const DEFAULT_UI_ORIGINS = ["http://localhost:5173"];
const MAX_BODY = 1_000_000;
const MAX_STATUS = 160;
const MAX_NAME = 60;
const MAX_STEPS = 15;
const MAX_STEP = 40;
const MAX_TODO = 80;
const MAX_TITLE = 120;
// Ids and titles end up as front matter lines; a line break would let a value forge keys.
const SAFE = /^[^\r\n\u0000-\u001f]+$/;

// token: a per-launch secret Electron hands to both wintosd and the UI. Any request that comes
// from a web origin must carry it, because the UI's origin alone proves nothing: every Vite
// dev server is http://localhost:5173 too.
const isRoadmapOp = (o: unknown): o is RoadmapOp => {
    const v = o as Record<string, unknown> | null;
    if (!v || typeof v !== "object") return false;
    const r = v.rename as { from?: unknown; to?: unknown } | undefined;
    const m = v.move as { name?: unknown; by?: unknown } | undefined;
    return typeof v.add === "string" || typeof v.remove === "string" || (typeof v.done === "string" && typeof v.on === "boolean") || (!!r && typeof r.from === "string" && typeof r.to === "string") || (!!m && typeof m.name === "string" && (m.by === 1 || m.by === -1));
};
// journal: a daily journal for the Today page; lunch: "HH:MM-HH:MM", never counted as free time.

export async function startServer(opts: { root: string; port: number; host?: string; uiOrigins?: string[]; plugins?: Plugin[]; token?: string; journal?: Journal; onJournalChange?: () => void; lunch?: string; workday?: string; recapCmd?: string; recapExtra?: string; fixCmd?: string; fixCwd?: string; repoNamesFile?: string; claudeDirs?: string[]; prNow?: (url: string, who: Who, events: WakeEvent[]) => Promise<PrNow | undefined>; wakeEveryMs?: number; fetchDone?: (urls: string[]) => Promise<DonePr[]>; checkout?: string; updateEveryMs?: number; restart?: (repo: string) => void; moveEveryMs?: number; termCols?: number; epicsRoot?: string; calendarIcs?: string; listAgents?: () => Promise<string | undefined>; bgSend?: (sessionId: string, cwd: string | undefined, prompt: string) => Promise<boolean>; bgLogs?: (bgId: string) => Promise<string | undefined>; bgStop?: (bgId: string) => Promise<boolean> }): Promise<WintosServer> {
    const store = new ProjectStore(opts.root);
    // Beside the projects in main.ts; a hidden folder in them by default, which the project store skips.
    const epics = new EpicStore(opts.epicsRoot ?? join(opts.root, ".epics"));
    // The standup's facts: what the PRs a day's sessions own, live or shelved, did that day.
    const factsOf = (ids: string[], day: string) => {
        const gh = ghData();
        if (!gh) return [];
        const urls = new Set(ids.flatMap((id) => [...(sessions.get(id)?.prs ?? []), ...Object.values(shelf).flat().filter((i) => i.sessionId === id).flatMap((i) => i.prs ?? [])]));
        return gh.prs.filter((pr) => urls.has(pr.url)).map((pr) => prFact(pr, gh.me, day));
    };
    const recapper = dayRecapper(opts.root, opts.recapCmd, opts.recapExtra, factsOf);
    // Ready before you open the Today page: the summarizer takes a minute. Cached, so this is
    // one run a day.
    const warmRecap = setInterval(() => void recapper.recap(Date.now()).catch(() => {}), 30 * 60_000);
    warmRecap.unref();
    // Each wake's PR is asked about on its own: a PR merged into main has left the PR list.
    const wakesFile = join(opts.root, ".wakes.json");
    let wakes = rekeyed(readJson<Wakes>(wakesFile, {}));
    const saveWakes = () => writeJsonAtomic(wakesFile, wakes);
    // A pause a wake made ends with it, cancelled, expired or impossible: the session no longer
    // waits on that PR, unless another of its wakes still holds it. True when one changed.
    const endWakePause = (gone: { sessionId: string; pr: string; until: WakeEvent }[]) => {
        let changed = false;
        for (const w of gone) {
            const s = sessions.get(w.sessionId);
            if (!s || (s.state !== "parked" && !s.parkPending) || s.parkedOn !== waitingOn(w) || Object.values(wakes).some((x) => x.sessionId === s.id)) continue;
            sessions = unparkSession(sessions, s.id, Date.now());
            changed = true;
        }
        return changed;
    };
    let checking = false;
    const checkWakes = async () => {
        const waiting = [...new Set(Object.values(wakes).filter((w) => !w.due).map((w) => w.pr))];
        if (checking || !waiting.length) return;
        checking = true;
        try {
            const gh = ghData() as { me: string; team?: string[] } | undefined;
            const who: Who = { me: gh?.me ?? "", team: gh?.team };
            const eventsOf = (u: string) => [...new Set(Object.values(wakes).filter((w) => w.pr === u).map((w) => w.until))];
            const now = Object.fromEntries(await Promise.all(waiting.map(async (u) => [u, await (opts.prNow ?? prNow)(u, who, eventsOf(u))] as const)));
            const next = afterCheck(wakes, Date.now(), now);
            for (const w of next.dropped) console.error(`[wintosd] wake dropped: ${waitingOn(w)} for session ${w.sessionId} (expired, or it can't happen any more)`);
            if (JSON.stringify(next.wakes) !== JSON.stringify(wakes)) {
                wakes = next.wakes;
                saveWakes();
                if (endWakePause(next.dropped)) saveSessions("a wake it waited on was dropped");
                broadcast();
            }
        } finally {
            checking = false;
        }
    };
    const wakeTimer = setInterval(() => void checkWakes(), opts.wakeEveryMs ?? 2 * 60_000);
    wakeTimer.unref();
    const uiOrigins = new Set(opts.uiOrigins ?? [...DEFAULT_UI_ORIGINS, ...(process.env.WINTOS_UI_ORIGINS?.split(",") ?? [])]);
    // Saved on every change and restored at start, so a restart doesn't forget who waits on you.
    const sessionFile = join(opts.root, ".sessions.json");
    let sessions = restoreSessions(readJson<Session[]>(sessionFile, []), Date.now());
    // Every change to a session leaves a line in the log, with what caused it: the request being
    // served (cause), or the reading that ran after one.
    let logged = sessions;
    const logEvent = eventLog(join(opts.root, ".events"));
    const cause = new AsyncLocalStorage<string>();
    const saveSessions = (why = cause.getStore() ?? "wintosd", always?: string) => {
        for (const line of trail(logged, sessions, why, (t) => store.byTab(t)?.title, always)) console.log(`[wintosd] ${line}`);
        for (const s of sessions.values()) {
            const moved = changes(logged.get(s.id), s);
            if (moved.length) logEvent("session", { id: s.id, epic: s.epic, cause: why, changes: moved });
        }
        for (const id of logged.keys()) if (!sessions.has(id)) logEvent("session", { id, cause: why, changes: ["gone"] });
        logged = sessions;
        writeJsonAtomic(sessionFile, [...sessions.values()]);
    };
    // Time at each epic (epics/time.ts): the session whose pane has focus in WintOS (POST /focus),
    // counted on the idle tick while the Mac is in use.
    const timeFile = join(opts.root, ".time.json");
    let timeLog = readJson<TimeLog>(timeFile, {});
    let focused: { sessionId: string; since: number } | undefined;
    let lastIdleMs = 0;
    const meetingCache = new Map<string, { ms: number; at: number }>();
    const countTime = (now: number, idleMs: number) => {
        if (!focused) return;
        if (idleMs < AWAY_MS) timeLog = addTime(timeLog, localDay(now), focused.sessionId, sessions.get(focused.sessionId)?.epic, now - focused.since);
        focused = { ...focused, since: now };
        writeJsonAtomic(timeFile, timeLog);
    };
    // A session nobody put in an epic takes the one beside it, or its lane's (epics/assign.ts).
    const placeInEpic = (sessionId: string) => {
        const s = sessions.get(sessionId);
        const epic = s && !s.epic ? impliedEpic(s, [...sessions.values()], epics.list()) : undefined;
        if (epic) sessions = setEpic(sessions, sessionId, epic);
    };
    const openEpics = () => epics.list().filter((e) => !e.done).map(({ id, title }) => ({ id, title }));
    // Each session sees the epic's mine.md change once, as for a project's (ProjectStore.mineDiff).
    const lastEpicMine = new Map<string, string>();
    const epicMineDiff = (epicId: string, sessionId: string) => {
        const text = epics.mine(epicId)?.text ?? "";
        const key = `${epicId}\u0000${sessionId}`;
        const before = lastEpicMine.get(key);
        lastEpicMine.set(key, text);
        return before === undefined || before === text ? { text } : { text, diff: lineDiff(before, text) };
    };
    const agentEpic = (sessionId: string) => {
        const e = sessions.get(sessionId)?.epic;
        const epic = e ? epics.byId(e) : undefined;
        return epic && epic.agent === sessionId ? epic : undefined;
    };
    const epicText = (sessionId: string, full: boolean) => {
        const e = sessions.get(sessionId)?.epic;
        const epic = e ? epics.byId(e) : undefined;
        if (epic && epic.agent === sessionId) {
            const workers = [...sessions.values()]
                .filter((w) => w.epic === epic.id && w.id !== sessionId && w.state !== "ended")
                .map((w) => ({ name: w.name?.text ?? w.label ?? "a session", state: w.background ? `${w.state}, in the background` : w.restored ? `${w.state}, not started until the developer opens it` : w.state, step: w.lane?.steps[w.lane.at], status: freshStatus(w)?.text, prs: w.prs ?? [], ask: w.state === "waiting" ? (w.ask?.text ?? w.outcome?.text) : undefined }));
            return epicAgentInjection({ title: epic.title, dir: epic.dir, steps: serializeUnits(epic.steps) }, workers, full, epicMineDiff(epic.id, sessionId));
        }
        // A session already linked to a step is not asked to claim one.
        const claimed = epic && Object.values(epic.links ?? {}).some((ids) => ids.includes(sessionId));
        return epicInjection(epic && { id: epic.id, title: epic.title, steps: claimed ? [] : epic.steps.filter((u) => u.state !== "done").map((u) => u.name) }, openEpics(), epic && epicMineDiff(epic.id, sessionId), full);
    };
    // What a session is told: the rules in full once (its start, a compact, or rules changed since
    // it was last told), else only what changed. The epic's agent keeps no project file of its
    // own: its plan is epic.md, so it gets the agent's text alone.
    const rulesSent = new Map<string, string>();
    const projectSeen = new Map<string, number>();
    const contextFor = (sessionId: string, tabId: string, start: boolean) => {
        const agent = !!agentEpic(sessionId);
        // Told afresh when the rules change, and when the session's project or epic does: their
        // text (the project file's path, the epic's notes) is part of the full rules.
        const version = `${agent ? RULES_VERSION.agent : RULES_VERSION.session}:${store.byTab(tabId)?.dir ?? "-"}:${sessions.get(sessionId)?.epic ?? "-"}`;
        const full = start || rulesSent.get(sessionId) !== version;
        rulesSent.set(sessionId, version);
        if (agent) return epicText(sessionId, full);
        const project = store.byTab(tabId);
        const changed = !!project && projectSeen.has(sessionId) && projectSeen.get(sessionId) !== project.mtime;
        if (project) projectSeen.set(sessionId, project.mtime);
        return [injection(project, store.mineDiff(tabId, sessionId), full, changed), epicText(sessionId, full)].filter(Boolean).join("\n\n");
    };
    // What the epics' sessions did, queued for each epic's agent (epics/reports.ts).
    const reportsFile = join(opts.root, ".epic-reports.json");
    let reports = readJson<Reports>(reportsFile, {});
    const reportUp = (sessionId: string) => {
        const s = sessions.get(sessionId);
        const agent = s?.epic ? epics.byId(s.epic)?.agent : undefined;
        if (!s || !agent || agent === s.id || !worthReporting(s)) return;
        const text = reportLine(s);
        reports = addReport(reports, agent, text, Date.now());
        writeJsonAtomic(reportsFile, reports);
        logEvent("report", { agent, from: s.id, epic: s.epic, text });
    };
    // What you told each epic agent, so a relay passes only your own words (epics/relay.ts): your
    // last few prompts to it, kept across restarts. Only the last one, in memory, refused a relay
    // quoting what you said two prompts back or before a restart.
    const saidFile = join(opts.root, ".agent-said.json");
    let saidTo = readJson<Record<string, string[]>>(saidFile, {});
    const SAID_KEPT = 5;
    // Each session's transcript, from its hook events, for wintos peek's last reply.
    const transcripts = new Map<string, string>();
    const relaysFile = join(opts.root, ".relays.json");
    let relays = readJson<Relays>(relaysFile, {});
    const saveRelays = (next: Relays) => ((relays = next), writeJsonAtomic(relaysFile, relays));
    // Sessions the epic agents started in the background (epics/bgstart.ts), followed through
    // `claude agents --json`: polled only while some are tracked.
    const bgFile = join(opts.root, ".bg-starts.json");
    let bgStarts = readJson<BgStarts>(bgFile, {});
    const listAgents = opts.listAgents ?? (() => new Promise<string | undefined>((resolve) => execFile("/bin/zsh", ["-lc", "claude agents --json --all"], { timeout: 30_000, maxBuffer: 1 << 22 }, (err, out) => resolve(err ? undefined : String(out)))));
    let bgPolling = false;
    const pollBg = async () => {
        if (bgPolling || !Object.keys(bgStarts).length) return;
        bgPolling = true;
        try {
            const out = await listAgents();
            if (out === undefined) return;
            const listed = parseAgents(out);
            const r = mergeBg(sessions, bgStarts, listed, Date.now());
            sessions = r.sessions;
            const kept = pruneStarts(bgStarts, sessions, Date.now());
            if (Object.keys(kept).length !== Object.keys(bgStarts).length) {
                bgStarts = kept;
                writeJsonAtomic(bgFile, bgStarts);
            }
            await deliverToBackground(listed);
            if (!r.moved.length) return;
            for (const f of r.fresh) {
                const epic = epics.byId(f.start.epic);
                const linked = epic && linkStep({ steps: epic.steps, links: epic.links ?? {} }, f.start.step, f.id);
                if (linked) epics.update(epic!.id, (e) => ({ ...e, steps: linked.steps, links: linked.links }));
            }
            saveSessions("the background service's listing");
            for (const id of r.moved) reportUp(id);
            broadcast();
        } finally {
            bgPolling = false;
        }
    };
    const bgTimer = setInterval(() => void pollBg(), 15_000);
    bgTimer.unref?.();
    // A background session has no pane to type into: what is passed on to it goes in as a prompt
    // through the background service, from the directory it runs in, once it is not at work.
    const bgSend = opts.bgSend ?? ((sessionId: string, cwd: string | undefined, prompt: string) => new Promise<boolean>((resolve) => execFile("/bin/zsh", ["-lc", 'claude --bg --resume "$0" "$1"', sessionId, prompt], { cwd, timeout: 30_000 }, (err) => resolve(!err))));
    // A background session's recent output, for wintos peek: it has no transcript WintOS heard of.
    const bgLogs = opts.bgLogs ?? ((bgId: string) => new Promise<string | undefined>((resolve) => execFile("/bin/zsh", ["-lc", 'claude logs "$0" | tail -n 60', bgId], { timeout: 30_000, maxBuffer: 1 << 20 }, (err, out) => resolve(err ? undefined : String(out).trim() || undefined))));
    const bgStop = opts.bgStop ?? ((bgId: string) => new Promise<boolean>((resolve) => execFile("/bin/zsh", ["-lc", 'claude stop "$0"', bgId], { timeout: 30_000 }, (err) => resolve(!err))));
    async function deliverToBackground(listed: BgAgent[]) {
        // Its due wakes too: the panes' renderers type a wake in, and a background session has no pane.
        for (const [wid, w] of Object.entries(wakes)) {
            const s = w.due ? sessions.get(w.sessionId) : undefined;
            if (!s?.bgId || s.attachedTo || s.state === "working" || s.state === "ended") continue;
            if (!(await bgSend(s.id, listed.find((a) => a.id === s.bgId)?.cwd, wakePrompt(w)))) continue;
            delete wakes[wid];
            saveWakes();
            logEvent("wake-delivered", { to: s.id, via: "background" });
        }
        for (const [to, list] of Object.entries(relays)) {
            const s = sessions.get(to);
            if (!s?.bgId || s.attachedTo || s.state === "working" || s.state === "ended" || !list.length) continue;
            const e = s.epic ? epics.byId(s.epic) : undefined;
            const prompt = list.map((r) => relayPrompt(r, e ? (e.short ?? e.title) : "epic")).join("\n");
            if (!(await bgSend(s.id, listed.find((a) => a.id === s.bgId)?.cwd, prompt))) continue;
            saveRelays(relaysDelivered(relays, to, list.length));
            logEvent("relays-delivered", { to, n: list.length, via: "background" });
        }
    }
    // The steps you prompted today, by session, for the journal's "Today's focus" (epics/worked.ts).
    const workedFile = join(opts.root, ".worked.json");
    let worked = readJson<{ day: string; ids: string[] }>(workedFile, { day: "", ids: [] });
    let lastFocus = "";
    const writeWorked = (prompted?: string) => {
        if (!opts.journal) return;
        const day = localDay(Date.now());
        if (worked.day !== day) worked = { day, ids: [] };
        if (prompted && !worked.ids.includes(prompted)) {
            worked = { day, ids: [...worked.ids, prompted] };
            writeJsonAtomic(workedFile, worked);
        }
        const steps = worked.ids.flatMap((id) => {
            const s = sessions.get(id);
            if (!s) return [];
            const e = s.epic ? epics.byId(s.epic) : undefined;
            return [{ epic: e && (e.short ?? e.title), step: s.name?.text ?? s.label ?? "a session" }];
        });
        const text = workedFocus(steps);
        if (!text || text === lastFocus) return;
        lastFocus = text;
        opts.journal.saveFocus(new Date(), text);
    };
    // When the developer last looked at each project: a reply after that is unread.
    const seenFile = join(opts.root, ".seen.json");
    const seen = readJson<Record<string, number>>(seenFile, {});
    const markSeen = (id: string) => ((seen[id] = Date.now()), writeJsonAtomic(seenFile, seen));
    // The keyboard game's score, per instance like the rest of this folder.
    const keyboardFile = join(opts.root, ".keyboard.json");
    let keyboard = readJson<KeyStats>(keyboardFile, emptyStats());
    // The day's breaks and the stretch since the last (rhythm.ts), fed the Mac's idle time.
    const rhythmFile = join(opts.root, ".rhythm.json");
    let rhythm = readJson<Rhythm>(rhythmFile, { day: localDay(Date.now()), stretchFrom: Date.now(), breaks: [] });
    const setRhythm = (next: Rhythm) => {
        if (next === rhythm) return;
        rhythm = next;
        writeJsonAtomic(rhythmFile, rhythm);
        broadcast();
    };
    const shelfFile = join(opts.root, ".shelf.json");
    let shelf = readJson<Shelf>(shelfFile, {});
    const saveShelf = (next: Shelf) => ((shelf = next), writeJsonAtomic(shelfFile, shelf));
    // One at a time: a title is one model call, and a backlog of them must not run at once.
    let titling = Promise.resolve();
    const titleShelved = (item: Shelved, project?: string) => {
        const cmd = opts.recapCmd;
        if (!cmd || item.title || item.named) return;
        titling = titling.then(async () => {
            const title = await writeTitle(cmd, titlePrompt({ project, gist: item.gist, status: item.name, label: item.label }));
            if (!title) return;
            saveShelf(withTitle(shelf, item.sessionId, title));
            broadcast();
        }).catch((e) => console.error(`[wintosd] titling a shelved session failed: ${e}`));
    };
    // A session nobody named gets one from what it did, after a turn, and again once its PRs or
    // lane changed. One at a time, behind the shelf titles.
    const modelNamedFor = new Map<string, string>();
    const nameByModel = (sessionId: string, transcript: string, project?: string) => {
        const cmd = opts.recapCmd;
        const s = sessions.get(sessionId);
        if (!cmd || !s || (s.name && s.name.by !== "model") || modelNamedFor.get(sessionId) === nameKey(s)) return;
        modelNamedFor.set(sessionId, nameKey(s));
        titling = titling.then(async () => {
            let text = "";
            try {
                text = readFileSync(transcript, "utf8");
            } catch {}
            const prompts = userPrompts(text);
            if (!prompts.length) return;
            const byUrl = new Map((ghData()?.prs ?? []).map((pr) => [pr.url, pr]));
            const open = (s.prs ?? []).map((u) => byUrl.get(u)).filter((pr): pr is PR => !!pr);
            const name = await writeTitle(cmd, namePrompt({ project, prompts, prs: open.map((pr) => `#${pr.number} ${pr.title}`), lane: s.lane?.name, branch: open[0]?.branch }));
            if (!name) return;
            sessions = titleSession(sessions, sessionId, name, Date.now());
            saveSessions("the model named it");
            broadcast();
        }).catch((e) => console.error(`[wintosd] naming a session failed: ${e}`));
    };
    // A turn that ended without saying what it expects (no `wintos ask`, wait or done): the model
    // reads its last message, and a guess stands in when it can't. Not behind the titles: it is
    // what the sidebar shows now.
    let reading = Promise.resolve();
    const readEndedTurn = (sessionId: string, message: string) => {
        const s = sessions.get(sessionId);
        // A turn that ended while its subagents run is not over: it is read when it really ends.
        if (!s || s.state !== "waiting" || s.ask || !s.turnEndedAt || liveSubagents(s, Date.now())) return;
        const turnAt = s.turnEndedAt;
        const cmd = opts.recapCmd;
        // Not your move while it is read: it may turn out done, paused or a question (STATE-11).
        if (cmd) sessions = new Map(sessions).set(sessionId, { ...s, reading: true });
        reading = reading.then(async () => {
            const out = cmd ? await oneShot(cmd, askPrompt(message)) : undefined;
            const modelRead = out ? parseAsk(out) : undefined;
            const read = modelRead || guessAsk(message);
            const read0 = sessions.get(sessionId);
            if (read0?.reading) sessions = new Map(sessions).set(sessionId, { ...read0, reading: undefined });
            const next = readTurn(sessions, sessionId, turnAt, read);
            if (next === sessions) return void (saveSessions("the model read the turn"), broadcast());
            sessions = next;
            saveSessions("the model read the turn");
            // What the read found goes up now; the Stop it came from was still undecided, so nothing
            // went up then. A question always; done or paused only when the model read it, as the
            // guess without it takes a status line ("still waiting on CI") for a report.
            if (modelRead || sessions.get(sessionId)?.ask) reportUp(sessionId);
            broadcast();
        }).catch((e) => {
            console.error(`[wintosd] reading a turn failed: ${e}`);
            const x = sessions.get(sessionId);
            if (x?.reading) sessions = new Map(sessions).set(sessionId, { ...x, reading: undefined });
        });
    };
    // A read cut off by a restart is read again: left as it was, the turn would wait forever.
    for (const s of [...sessions.values()].filter((x) => x.reading)) {
        sessions = new Map(sessions).set(s.id, { ...s, reading: undefined });
        readEndedTurn(s.id, s.outcome?.text ?? "");
    }
    const applyTouch = (r: { sessions: Map<string, Session>; shelf: Shelf }) => {
        sessions = r.sessions;
        if (r.shelf !== shelf) saveShelf(r.shelf);
    };
    // false: no project on that tab.
    const shelveSession = (tabId: string, sessionId: string, script: string, label?: string) => {
        const p = store.byTab(tabId);
        if (!p) return false;
        // A session resumed and closed again before a prompt has no label: its recap names it.
        const gist = recapper.gistOf(sessionId);
        const name = sessions.get(sessionId)?.status?.text;
        const owned = sessions.get(sessionId)?.prs;
        const given = sessions.get(sessionId)?.name;
        const touched = sessions.get(sessionId)?.touched;
        const epic = sessions.get(sessionId)?.epic;
        const item: Shelved = { sessionId, script, label: label ?? gist ?? "session", ...(name ? { name } : {}), ...(given ? { named: given } : {}), ...(epic ? { epic } : {}), ...(touched?.length ? { touched } : {}), gist, ...(owned?.length ? { prs: owned } : {}), at: Date.now() };
        saveShelf(shelve(shelf, basename(p.dir), item, 14));
        titleShelved(item, p.title);
        return true;
    };
    // One saved before sessions carried their resume command resumes from its directory.
    const shelveLive = (l: Session) => {
        // A session never prompted saved no conversation: resuming it only says "No conversation found".
        const script = l.resume ?? (l.cwd && (l.promptAt || l.label) && `cd '${l.cwd.replace(/'/g, "'\\''")}' && claude --resume '${l.id}'`);
        if (script && resumedSession(script) === l.id) shelveSession(l.tabId, l.id, script, l.label);
    };
    const sockets = new Set<WebSocket>();
    let port = opts.port;

    // Heads-ups from Claude Code's "You should know" plugin: read from each Claude config dir's
    // plugin store as it changes, kept here until closed, since the plugin clears its own.
    const headsFile = join(opts.root, ".headsups.json");
    let headsUps = readJson<HeadsUp[]>(headsFile, []);
    const health = new Map<string, Health>();
    const storeWatchers = new Map<string, FSWatcher>();
    const headsUpProblem = () => [...health.values()].find((h) => h.problem)?.problem;
    const projectOf = (sessionId: string) => {
        const s = sessions.get(sessionId);
        const p = s && store.byTab(s.tabId);
        return p ? basename(p.dir) : undefined;
    };
    const readHeadsUps = (dir: string) => {
        let file: string | undefined;
        let raw: unknown;
        try {
            file = readdirSync(dir).find((f) => f.startsWith(STORE_PREFIX) && f.endsWith(".json"));
            if (!file) return;
            raw = JSON.parse(readFileSync(join(dir, file), "utf8"));
        } catch {
            return; // the folder gone, or the file caught mid-write: the next change reads it whole
        }
        const read = readStore(raw);
        const was = health.get(dir) ?? { missed: 0 };
        const now = watchHealth(was, read);
        health.set(dir, now);
        if (now.problem && now.problem !== was.problem) console.error(`[wintosd] heads-ups from ${join(dir, file)}: ${now.problem}`);
        const next = "offers" in read ? capture(headsUps, read.offers, projectOf) : headsUps;
        if (next === headsUps && now.problem === was.problem) return;
        headsUps = next;
        writeJsonAtomic(headsFile, headsUps);
        broadcast();
    };
    const watchStore = (configDir: string) => {
        const dir = join(configDir, "plugins", "store");
        if (storeWatchers.has(dir) || !existsSync(dir)) return;
        let soon: NodeJS.Timeout | undefined;
        try {
            const w = watch(dir, () => (clearTimeout(soon), (soon = setTimeout(() => readHeadsUps(dir), 50))));
            w.on("error", (e) => console.error(`[wintosd] heads-up watcher on ${dir} failed: ${e}`));
            storeWatchers.set(dir, w);
            readHeadsUps(dir);
        } catch (e) {
            console.error(`[wintosd] cannot watch ${dir}: ${e}`);
        }
    };

    // Your short names for repos (n in the PR list), in your config: read again whenever it changes,
    // so a hand edit shows without a restart.
    let repoNames: { mtime: number; names: Record<string, string> } = { mtime: -1, names: {} };
    const namesOfRepos = () => {
        if (!opts.repoNamesFile) return {};
        let mtime = 0;
        try {
            mtime = statSync(opts.repoNamesFile).mtimeMs;
        } catch {}
        if (mtime !== repoNames.mtime) repoNames = { mtime, names: readJson<Record<string, string>>(opts.repoNamesFile, {}) };
        return repoNames.names;
    };
    const state = () => ({
        now: Date.now(),
        repoNames: namesOfRepos(),
        wakes,
        sessions: [...sessions.values()],
        projects: store.list().map(({ body: _body, ...p }) => p),
        // plan: epic.md's body, which the epic agent keeps (goal, milestones, open issues, blockers).
        // mineFirst: mine.md's first line, for the epic's card on the home.
        epics: epics.list().map(({ body, ...e }) => ({ ...e, plan: body.trim(), mineFirst: (epics.mine(e.id)?.text ?? "").split("\n").map((l) => l.replace(/^[-*#\s]+/, "").trim()).find(Boolean) })),
        epicReports: reports,
        relays,
        plugins: runner.results,
        donePrs,
        pluginNames: runner.names,
        pluginsRunning: runner.running,
        snoozes,
        seen,
        fixer: fixer.state(),
        update: { behind: update?.behind() ?? 0 },
        termCols: opts.termCols ?? 110,
        rhythm: { ...rhythm, everyMs: opts.moveEveryMs ?? 30 * 60_000 },
        ...(opts.journal ? { day: opts.journal.day(new Date()) } : {}),
        keyboard,
        headsUps: Object.fromEntries(store.list().flatMap((p) => {
            const mine = p.id ? headsUps.filter((h) => h.project === basename(p.dir)) : [];
            return mine.length ? [[p.id, mine]] : [];
        })),
        ...(headsUpProblem() ? { headsUpProblem: headsUpProblem() } : {}),
        // By the tab the project's folder belongs to now.
        shelf: Object.fromEntries(store.list().flatMap((p) => (p.id && shelf[basename(p.dir)] ? [[p.id, shelf[basename(p.dir)]]] : []))),
        ...(opts.lunch ? { lunch: opts.lunch } : {}),
        ...(opts.workday ? { workday: opts.workday } : {}),
    });
    const broadcast = () => {
        const frame = JSON.stringify(state());
        for (const s of sockets) s.send(frame);
    };
    const update = opts.checkout ? updateWatch(opts.checkout, broadcast, opts.updateEveryMs) : undefined;
    // Sessions shelved before titles existed get theirs now.
    for (const list of Object.values(shelf)) for (const item of list) titleShelved(item);

    // Kept next to the projects: a file there is not a project (those are folders).
    const snoozeFile = join(opts.root, ".snoozes.json");
    let snoozes = readJson<Snoozes>(snoozeFile, {});
    const fixer = new Fixer(opts.root, () => broadcast(), opts.fixCmd, opts.fixCwd);
    const ghData = () => runner.results["gh-prs"]?.data as { me: string; prs: PR[] } | undefined;
    // Every PR refresh is a chance for the conflicts babysitter.
    const runner = new PluginRunner(opts.plugins ?? [], () => {
        const gh = ghData();
        if (gh) fixer.consider(gh.prs, gh.me);
        broadcast();
        void checkDone();
    });
    // The sessions' PRs the PR list doesn't hold, once they are merged or closed: their chips say so.
    const doneFile = join(opts.root, ".done-prs.json");
    let donePrs = readJson<Record<string, DonePr>>(doneFile, {});
    let askingDone = false;
    // A roadmap step naming a PR that merged is done by itself; its agent hears of it.
    const closeMergedSteps = () => {
        const merged = Object.values(donePrs).filter((d) => d.merged);
        if (!merged.length) return;
        for (const epic of epics.list().filter((e) => !e.done)) {
            for (const name of mergedSteps(epic.steps, merged)) {
                const now = epics.byId(epic.id);
                const r = now && editRoadmap({ steps: now.steps, links: now.links ?? {} }, { done: name, on: true });
                if (!r || typeof r === "string") continue;
                epics.update(epic.id, (e) => ({ ...e, steps: r.steps }));
                logEvent("roadmap", { epic: epic.id, by: "a merged PR", note: r.note });
                if (epic.agent) {
                    reports = addReport(reports, epic.agent, `roadmap: "${name}" is done by itself, its PR merged`, Date.now());
                    writeJsonAtomic(reportsFile, reports);
                }
                broadcast();
            }
        }
    };
    const checkDone = async () => {
        closeMergedSteps();
        const gh = ghData();
        const urls = [...sessions.values(), ...Object.values(shelf).flat()].flatMap((x) => [...(x.prs ?? []), ...(x.touched ?? [])]);
        const ask = gh ? unlisted(urls, new Set(gh.prs.map((p) => p.url)), donePrs) : [];
        if (askingDone || !ask.length) return;
        askingDone = true;
        try {
            const found = await (opts.fetchDone ?? fetchDone)(ask);
            if (!found.length) return;
            donePrs = { ...donePrs, ...Object.fromEntries(found.map((d) => [d.url, d])) };
            writeJsonAtomic(doneFile, donePrs);
            closeMergedSteps();
            broadcast();
        } finally {
            askingDone = false;
        }
    };

    let watcher: FSWatcher | undefined;
    let pending: NodeJS.Timeout | undefined;
    const reload = () => {
        try {
            store.reload();
            epics.reload();
            broadcast();
        } catch (e) {
            console.error(`[wintosd] reload failed, keeping the last good state: ${e}`);
        }
    };
    try {
        watcher = watch(opts.root, { recursive: true }, (_e, file) => {
            if (file && isDaemonFile(file)) return;
            clearTimeout(pending);
            pending = setTimeout(reload, 100);
        });
        watcher.on("error", (e) => console.error(`[wintosd] watcher error, note edits will not show until restart: ${e}`));
    } catch (e) {
        console.error(`[wintosd] cannot watch ${opts.root}: ${e}`);
    }
    // epic.md and an epic's mine.md are edited outside WintOS too: by the epic agent (the plan) and
    // in your editor. A change there is read and pushed like a note edit.
    let epicsWatcher: FSWatcher | undefined;
    try {
        epicsWatcher = watch(epics.root, { recursive: true }, () => {
            clearTimeout(pending);
            pending = setTimeout(reload, 100);
        });
        epicsWatcher.on("error", (e) => console.error(`[wintosd] epics watcher error: ${e}`));
    } catch (e) {
        console.error(`[wintosd] cannot watch ${epics.root}: ${e}`);
    }
    // The journal is edited outside WintOS too (your editor, the journal's own command): a change
    // there is pushed like a note edit, not only seen by the next request.
    let journalWatcher: FSWatcher | undefined;
    if (opts.journal)
        try {
            journalWatcher = watch(opts.journal.dir, { recursive: true }, () => {
                opts.onJournalChange?.();
                clearTimeout(pending);
                pending = setTimeout(reload, 100);
            });
            journalWatcher.on("error", (e) => console.error(`[wintosd] journal watcher error: ${e}`));
        } catch (e) {
            console.error(`[wintosd] cannot watch the journal: ${e}`);
        }

    // Only the hook (no Origin) and the WintOS UI may talk to us. Any web page in any browser
    // on this machine can reach 127.0.0.1, and the Host check stops DNS rebinding.
    const refusal = (req: http.IncomingMessage): string | null => {
        const host = req.headers.host ?? "";
        if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return "bad host";
        const origin = req.headers.origin;
        if (!origin) return null; // the hook and the CLI: local processes, not web pages
        if (!uiOrigins.has(origin)) return "origin not allowed";
        if (req.method === "OPTIONS") return null; // preflights never carry custom headers
        const given = req.headers["x-wintos-token"] ?? new URL(req.url ?? "/", "http://x").searchParams.get("token");
        if (!opts.token || given !== opts.token) return "missing or wrong launch token";
        return null;
    };

    const server = http.createServer(async (req, res) => {
        const refused = refusal(req);
        if (refused) return send(res, 403, refused);
        if (req.headers.origin) {
            res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
            res.setHeader("Vary", "Origin");
        }
        try {
            const url = new URL(req.url ?? "/", "http://x");
            const cli = /^\/blocks\/[^/]+\/(\w+)/.exec(url.pathname);
            cause.enterWith(cli ? `wintos ${cli[1]}` : `${req.method} ${url.pathname.replace(/^\/(sessions|projects)\/[^/]+/, "/$1/…")}`);
            // The session a `wintos` call names (?session=), for the block routes.
            const sid = isSafe(url.searchParams.get("session")) ? url.searchParams.get("session")! : undefined;
            if (req.method === "OPTIONS") {
                res.setHeader("Access-Control-Allow-Headers", "content-type, x-wintos-token");
                res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT");
                return send(res, 204, "");
            }
            if (req.method === "GET" && url.pathname === "/state") return json(res, state());
            if (req.method === "POST" && !/^application\/json\b/.test(req.headers["content-type"] ?? ""))
                return send(res, 415, "POST bodies must be application/json");
            if (req.method === "POST" && url.pathname === "/events") {
                const ev = (await body(req)) as HookEvent;
                const p = ev?.payload;
                if (![ev?.tabId, ev?.blockId, p?.session_id, p?.hook_event_name].every(isSafe))
                    return send(res, 400, "need string tabId, blockId, payload.session_id, payload.hook_event_name");
                const before = sessions.get(p.session_id);
                const left = leavingFor(sessions, ev);
                // Shelved before the reduce drops them, while their status and PRs are still on hand.
                for (const l of left) shelveLive(l);
                sessions = reduceSession(sessions, ev, Date.now());
                const typed = typeof p.prompt === "string" ? ` (you sent ${p.prompt.length} characters)` : "";
                const hook = `hook ${p.hook_event_name}${p.tool_name ? ` ${p.tool_name}` : ""}${p.kind === "bg" ? " from the background service" : ""}${typed}`;
                // Running again: started or prompted. Closing its pane ends it (SessionEnd) on the way onto the shelf.
                // Off the shelf, it takes back the PRs it had there.
                const runs = p.hook_event_name === "SessionStart" || p.hook_event_name === "UserPromptSubmit";
                const shelved = Object.values(shelf).flat().find((i) => i.sessionId === p.session_id);
                if (runs && shelved) {
                    saveShelf(unshelve(shelf, p.session_id));
                    // Its name comes back with it, as whoever gave it.
                    const back = sessions.get(p.session_id);
                    if (shelved.named && back && !back.name) sessions = new Map(sessions).set(back.id, { ...back, name: shelved.named });
                    const home = sessions.get(p.session_id);
                    if (shelved.epic && home && !home.epic) sessions = setEpic(sessions, home.id, shelved.epic);
                    const again = sessions.get(p.session_id);
                    const union = (a: string[] = [], b: string[] = []) => [...new Set([...a, ...b])];
                    if (again) sessions = new Map(sessions).set(again.id, { ...again, prs: union(again.prs, shelved.prs), touched: union(again.touched, shelved.touched) });
                }
                // After the shelf gave back its epic: the epic beside it only places one that has none.
                placeInEpic(p.session_id);
                // A gh pr command that acts on a PR touches it; reading one (gh pr view) does not.
                if (p.hook_event_name === "PostToolUse" && p.pr_verb !== "view") applyTouch(touchPrs(sessions, shelf, p.session_id, prLinks(p.prs)));
                saveSessions(hook, p.hook_event_name === "UserPromptSubmit" ? p.session_id : undefined);
                const configDir = (p as { config_dir?: unknown }).config_dir;
                if (opts.claudeDirs && typeof configDir === "string" && configDir.startsWith("/")) watchStore(configDir);
                const tp = (p as { transcript_path?: unknown }).transcript_path;
                if (typeof tp === "string" && tp.startsWith("/")) transcripts.set(p.session_id, tp);
                if (p.hook_event_name === "Stop" && typeof tp === "string") nameByModel(p.session_id, tp, store.byTab(ev.tabId)?.title);
                if (p.hook_event_name === "Stop" && typeof p.last_assistant_message === "string" && p.last_assistant_message.trim()) readEndedTurn(p.session_id, p.last_assistant_message);
                // Yours: a prompt you typed, not one WintOS typed in (a report, a wake, a relay).
                const yours = p.hook_event_name === "UserPromptSubmit" && typeof p.prompt === "string" && !isWintosPrompt(p.prompt);
                recapper.record(ev.tabId, store.byTab(ev.tabId)?.title ?? "Untitled", p.session_id, typeof tp === "string" ? tp : undefined, yours, Date.now(), yours ? waitedFor(before, Date.now()) : 0);
                if (yours) markSeen(p.session_id); // you read it to answer it
                if (yours && epics.list().some((e) => e.agent === p.session_id)) {
                    saidTo = { ...saidTo, [p.session_id]: [...(saidTo[p.session_id] ?? []), p.prompt as string].slice(-SAID_KEPT) };
                    writeJsonAtomic(saidFile, saidTo);
                }
                if (yours && p.kind !== "bg") writeWorked(p.session_id);
                if (p.hook_event_name === "Stop" && p.kind !== "bg") reportUp(p.session_id);
                if (yours && p.kind !== "bg") setRhythm(prompted(rhythm, Date.now(), (p.prompt as string).length));
                // SessionStart's text reaches Claude as context too: at a start, a resume, a compact or /clear.
                const text = p.hook_event_name === "UserPromptSubmit" || p.hook_event_name === "SessionStart" ? contextFor(p.session_id, ev.tabId, p.hook_event_name === "SessionStart") : "";
                broadcast();
                return send(res, 200, text);
            }
            const plugin = /^\/plugins\/([^/]+)\/run$/.exec(url.pathname);
            if (req.method === "POST" && plugin) {
                return (await runner.run(decodeURIComponent(plugin[1]))) ? send(res, 200, "") : send(res, 404, "no such plugin");
            }
            if (req.method === "GET" && url.pathname === "/projects/texts") return json(res, store.texts());
            if (req.method === "POST" && url.pathname === "/repos/name") {
                const b = (await body(req)) as { repo?: unknown; short?: unknown };
                if (!opts.repoNamesFile) return send(res, 404, "no repo names file");
                if (typeof b?.repo !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(b.repo) || typeof b.short !== "string" || b.short.trim().length > 16) return send(res, 400, "need repo (owner/name) and short, up to 16 characters; empty removes it");
                const { [b.repo]: _was, ...rest } = namesOfRepos();
                const names = b.short.trim() ? { ...rest, [b.repo]: b.short.trim() } : rest;
                mkdirSync(dirname(opts.repoNamesFile), { recursive: true });
                writeFileSync(opts.repoNamesFile, JSON.stringify(names, null, 2) + "\n");
                broadcast();
                return send(res, 200, "");
            }
            if (req.method === "GET" && url.pathname === "/day/recap") return json(res, await recapper.recap(Date.now()));
            if (req.method === "PUT" && url.pathname === "/day/recap") {
                const b = (await body(req)) as { text?: unknown };
                if (typeof b?.text !== "string" || b.text.length > 8000) return send(res, 400, "need text, the list as markdown, up to 8000 characters");
                const shown = await recapper.editList(b.text, Date.now());
                return shown ? json(res, shown) : send(res, 404, "no day to edit");
            }
            if (req.method === "POST" && url.pathname === "/keyboard") {
                const b = (await body(req)) as { kind?: unknown; key?: unknown };
                if ((b?.kind !== "key" && b?.kind !== "click") || typeof b.key !== "string" || !b.key || b.key.length > 24) return send(res, 400, "need kind key|click and the key");
                keyboard = (b.kind === "key" ? recordKey : recordClick)(keyboard, b.key, Date.now());
                writeJsonAtomic(keyboardFile, keyboard);
                broadcast();
                return send(res, 200, "");
            }
            if ((url.pathname.startsWith("/day/") || url.pathname === "/reflection") && !opts.journal) return send(res, 404, "no journal: set WINTOS_JOURNAL_DIR");
            if (req.method === "POST" && url.pathname === "/day/focus") {
                const b = (await body(req)) as { text?: unknown; baseMtime?: unknown };
                if (typeof b?.text !== "string" || b.text.length > 20_000) return send(res, 400, "need the focus text");
                const text = await formatMarkdown(b.text);
                const r = opts.journal!.saveFocus(new Date(), text, typeof b.baseMtime === "number" ? b.baseMtime : undefined);
                if (r === "conflict") return send(res, 409, "the day's file changed on disk");
                // All of today's focus ticked: the keyboard game's day-done bonus (once a day).
                if (/\[[xX]\]/.test(text) && !/^\s*[-*] \[[ ~]\]/m.test(text)) {
                    keyboard = recordDayDone(keyboard, Date.now());
                    writeJsonAtomic(keyboardFile, keyboard);
                }
                broadcast();
                return send(res, 200, "");
            }
            if (req.method === "GET" && url.pathname === "/reflection") {
                const r = opts.journal!.reflection(new Date(), url.searchParams.get("date") ?? undefined);
                if (!r) return send(res, 404, "no reflection in the journal yet");
                return json(res, { ...r, days: r.days.map((d) => ({ ...d, readOut: recapper.readOut(d.date), numbers: recapper.numbersOf(d.date) })) });
            }
            if (req.method === "POST" && url.pathname === "/reflection") {
                const b = (await body(req)) as { date?: unknown; body?: unknown; baseMtime?: unknown };
                if (typeof b?.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.date) || typeof b.body !== "string" || b.body.length > 100_000 || typeof b.baseMtime !== "number") return send(res, 400, "need the date, the body and baseMtime");
                const r = opts.journal!.saveReflection(b.date, b.body, b.baseMtime);
                if (r === "missing") return send(res, 404, "no reflection on that day");
                if (r === "conflict") return send(res, 409, "the day's file changed on disk");
                broadcast();
                return send(res, 200, "");
            }
            if (req.method === "POST" && url.pathname === "/day/planned") {
                opts.journal!.markPlanned(new Date());
                broadcast();
                return send(res, 200, "");
            }
            const reopen = /^\/projects\/([^/]+)\/reopen$/.exec(url.pathname);
            if (req.method === "POST" && reopen) {
                const b = (await body(req)) as { tabId?: unknown };
                if (!isSafe(b?.tabId)) return send(res, 400, "need the new tab's id");
                const r = store.reopen(decodeURIComponent(reopen[1]), b.tabId);
                if (r !== "ok") return send(res, r === "taken" ? 409 : 404, r);
                broadcast();
                return send(res, 200, "");
            }
            // ⇧⌘W: the project's sessions go on its shelf before its tab closes and takes their panes.
            const shelveAll = /^\/projects\/([^/]+)\/shelve-all$/.exec(url.pathname);
            if (req.method === "POST" && shelveAll) {
                const tabId = decodeURIComponent(shelveAll[1]);
                if (!store.byTab(tabId)) return send(res, 404, "no project for this tab");
                const closing = [...sessions.values()].filter((s) => s.tabId === tabId && s.state !== "ended");
                for (const s of closing) shelveLive(s);
                sessions = endSessions(sessions, closing.map((s) => s.id), Date.now());
                saveSessions();
                broadcast();
                return send(res, 200, "");
            }
            const toShelf = /^\/projects\/([^/]+)\/shelf$/.exec(url.pathname);
            if (req.method === "POST" && toShelf) {
                const b = (await body(req)) as { script?: unknown; label?: unknown };
                const sessionId = typeof b?.script === "string" ? resumedSession(b.script) : undefined;
                if (!sessionId) return send(res, 400, "need the pane's resume command");
                const label = typeof b.label === "string" && b.label && isSafe(b.label) ? b.label.slice(0, MAX_TITLE) : undefined;
                if (!shelveSession(decodeURIComponent(toShelf[1]), sessionId, b.script as string, label)) return send(res, 404, "no project for this tab");
                sessions = endSessions(sessions, [sessionId], Date.now());
                saveSessions();
                broadcast();
                return send(res, 200, "");
            }
            const notes = /^\/projects\/([^/]+)\/notes$/.exec(url.pathname);
            if (req.method === "GET" && notes) {
                const n = store.notes(decodeURIComponent(notes[1]));
                return n ? json(res, n) : send(res, 404, "no project for this tab");
            }
            const mine = /^\/projects\/([^/]+)\/mine$/.exec(url.pathname);
            if (req.method === "POST" && mine) {
                const b = (await body(req)) as { text?: unknown; baseMtime?: unknown };
                if (typeof b?.text !== "string") return send(res, 400, "need text");
                const r = store.saveMine(decodeURIComponent(mine[1]), await formatMarkdown(b.text), typeof b.baseMtime === "number" ? b.baseMtime : undefined);
                if (r === "no project") return send(res, 404, "no project for this tab");
                if (r === "conflict") return send(res, 409, "mine.md changed on disk since you started editing");
                return send(res, 200, "");
            }
            // An epic's mine.md, the notes every session in it reads; its page and the rail edit it.
            const epicMine = /^\/epics\/([^/]+)\/mine$/.exec(url.pathname);
            if (epicMine) {
                const id = decodeURIComponent(epicMine[1]);
                if (req.method === "GET") {
                    const m = epics.mine(id);
                    return m ? json(res, m) : send(res, 404, "no such epic");
                }
                if (req.method === "POST") {
                    const b = (await body(req)) as { text?: unknown; baseMtime?: unknown };
                    if (typeof b?.text !== "string") return send(res, 400, "need text");
                    const r = epics.saveMine(id, await formatMarkdown(b.text), typeof b.baseMtime === "number" ? b.baseMtime : undefined);
                    if (r === "no epic") return send(res, 404, "no such epic");
                    if (r === "conflict") return send(res, 409, "mine.md changed on disk since you started editing");
                    broadcast();
                    return send(res, 200, "");
                }
            }
            // Renamed (its page's r): the title, and the short name ("" drops it). Its folder and id
            // stay, so links and sessions keep pointing at it. Its agent hears of it.
            const epicTitle = /^\/epics\/([^/]+)\/title$/.exec(url.pathname);
            if (req.method === "POST" && epicTitle) {
                const b = (await body(req)) as { title?: unknown; short?: unknown };
                const title = typeof b?.title === "string" ? b.title.trim() : "";
                const short = typeof b?.short === "string" ? b.short.trim() : undefined;
                if (!title || !isSafe(title) || title.length > EPIC_TITLE_MAX || (b.short !== undefined && typeof b.short !== "string") || (short && (!isSafe(short) || short.length > SHORT_MAX)))
                    return send(res, 400, `need a one-line title up to ${EPIC_TITLE_MAX} characters, and an optional short name up to ${SHORT_MAX}`);
                const before = epics.byId(decodeURIComponent(epicTitle[1]));
                const e = epics.update(decodeURIComponent(epicTitle[1]), ({ short: was, ...rest }) => ({ ...rest, title, ...(short === undefined ? (was ? { short: was } : {}) : short ? { short } : {}) }));
                if (!e || !before) return send(res, 404, "no such epic");
                if (e.agent && before.title !== e.title) {
                    reports = addReport(reports, e.agent, `the developer renamed the epic from "${before.title}" to "${e.title}"`, Date.now());
                    writeJsonAtomic(reportsFile, reports);
                }
                broadcast();
                return send(res, 200, "");
            }
            // A place up or down in your order of the epics (the home's ⇧J/⇧K).
            const epicMove = /^\/epics\/([^/]+)\/move$/.exec(url.pathname);
            if (req.method === "POST" && epicMove) {
                const b = (await body(req)) as { by?: unknown };
                if (b?.by !== 1 && b?.by !== -1) return send(res, 400, "need by: 1 or -1");
                const ranks = moveEpic(epics.list().filter((e) => !e.done), decodeURIComponent(epicMove[1]), b.by);
                if (!ranks) return send(res, 409, "it can't go further that way");
                for (const [id, rank] of ranks) if (epics.byId(id)?.rank !== rank) epics.update(id, (e) => ({ ...e, rank }));
                broadcast();
                return send(res, 200, "");
            }
            // Pinned (its page's p): kept in sight at the top of the sidebar, or not.
            const epicPin = /^\/epics\/([^/]+)\/pin$/.exec(url.pathname);
            if (req.method === "POST" && epicPin) {
                const b = (await body(req)) as { pinned?: unknown };
                if (typeof b?.pinned !== "boolean") return send(res, 400, "need pinned: true or false");
                const e = epics.update(decodeURIComponent(epicPin[1]), ({ pinned: _, ...rest }) => (b.pinned ? { ...rest, pinned: true } : rest));
                if (!e) return send(res, 404, "no such epic");
                broadcast();
                return send(res, 200, "");
            }
            // The roadmap edited by hand on the epic's page (epics/roadmap.ts). The epic agent hears of
            // every edit, so it can bring the plan in line with it.
            const roadmapEdit = /^\/epics\/([^/]+)\/roadmap$/.exec(url.pathname);
            if (req.method === "POST" && roadmapEdit) {
                const op = (await body(req)) as RoadmapOp;
                const epic = epics.byId(decodeURIComponent(roadmapEdit[1]));
                if (!epic) return send(res, 404, "no such epic");
                if (!isRoadmapOp(op)) return send(res, 400, "need one of add, rename {from, to}, move {name, by: 1 or -1}, done + on, remove");
                const r = editRoadmap({ steps: epic.steps, links: epic.links ?? {} }, op);
                if (typeof r === "string") return send(res, r === "no such step" ? 404 : r.includes("already") || r.includes("at most") ? 409 : 400, r);
                epics.update(epic.id, ({ links: _, ...e }) => ({ ...e, steps: r.steps, ...(Object.keys(r.links).length ? { links: r.links } : {}) }));
                if (r.note) logEvent("roadmap", { epic: epic.id, by: "developer", note: r.note });
                if (r.note && epic.agent) {
                    reports = addReport(reports, epic.agent, `roadmap edited by the developer on the epic page: ${r.note}`, Date.now());
                    writeJsonAtomic(reportsFile, reports);
                }
                broadcast();
                return send(res, 200, "");
            }
            // The session started from a planned step (⏎ on the epic page, or ⌘N with that step):
            // the step is current and the session linked to it.
            const sessionUnit = /^\/sessions\/([^/]+)\/unit$/.exec(url.pathname);
            if (req.method === "POST" && sessionUnit) {
                const b = (await body(req)) as { unit?: unknown };
                const s = sessions.get(decodeURIComponent(sessionUnit[1]));
                if (!s) return send(res, 404, "no such session");
                const epic = s.epic ? epics.byId(s.epic) : undefined;
                if (!epic) return send(res, 409, "the session is in no epic");
                const r = typeof b?.unit === "string" ? linkStep({ steps: epic.steps, links: epic.links ?? {} }, b.unit, s.id) : undefined;
                if (!r) return send(res, 404, "no such step in the epic's roadmap");
                epics.update(epic.id, (e) => ({ ...e, steps: r.steps, links: r.links }));
                broadcast();
                return send(res, 200, "");
            }
            // The UI typed the first n reports into the agent.
            const reportsDone = /^\/agents\/([^/]+)\/reports\/delivered$/.exec(url.pathname);
            if (req.method === "POST" && reportsDone) {
                const b = (await body(req)) as { n?: unknown };
                if (typeof b?.n !== "number" || !(b.n >= 0)) return send(res, 400, "need n, how many were typed in");
                reports = reportsDelivered(reports, decodeURIComponent(reportsDone[1]), b.n);
                logEvent("reports-delivered", { agent: decodeURIComponent(reportsDone[1]), n: b.n });
                writeJsonAtomic(reportsFile, reports);
                broadcast();
                return send(res, 200, "");
            }
            // The session that is the epic's agent (its page's a starts one), or none.
            const epicAgent = /^\/epics\/([^/]+)\/agent$/.exec(url.pathname);
            if (req.method === "POST" && epicAgent) {
                const b = (await body(req)) as { sessionId?: unknown };
                if (b?.sessionId !== null && !isSafe(b?.sessionId)) return send(res, 400, "need sessionId, a session's id or null");
                const id = decodeURIComponent(epicAgent[1]);
                if (typeof b.sessionId === "string" && epics.list().some((x) => !x.done && x.id !== id && x.agent === b.sessionId)) return send(res, 409, "that session is already another epic's agent");
                const e = epics.update(id, ({ agent: _, ...rest }) => (typeof b.sessionId === "string" ? { ...rest, agent: b.sessionId } : rest));
                if (!e) return send(res, 404, "no such epic");
                if (typeof b.sessionId === "string") sessions = setEpic(sessions, b.sessionId, id);
                saveSessions();
                broadcast();
                return send(res, 200, "");
            }
            // Finished (its page's x), or open again: a finished epic stays for the month's report.
            const epicDone = /^\/epics\/([^/]+)\/done$/.exec(url.pathname);
            if (req.method === "POST" && epicDone) {
                const b = (await body(req)) as { done?: unknown };
                if (typeof b?.done !== "boolean") return send(res, 400, "need done: true or false");
                const e = epics.update(decodeURIComponent(epicDone[1]), ({ done: _, ...rest }) => (b.done ? { ...rest, done: localDay(Date.now()) } : rest));
                if (!e) return send(res, 404, "no such epic");
                broadcast();
                return send(res, 200, "");
            }
            if (req.method === "POST" && url.pathname === "/prs/snooze") {
                const b = (await body(req)) as { url?: unknown; until?: unknown; movedAt?: unknown };
                if (typeof b?.url !== "string" || !PR_URL.test(b.url)) return send(res, 400, "need a GitHub PR url");
                if (b.until === null) delete snoozes[b.url];
                else if (typeof b.until === "number" && typeof b.movedAt === "string") snoozes[b.url] = { until: b.until, movedAt: b.movedAt };
                else return send(res, 400, "need until (a time, or null to wake) and movedAt");
                const now = Date.now();
                snoozes = Object.fromEntries(Object.entries(snoozes).filter(([, s]) => s.until > now));
                writeJsonAtomic(snoozeFile, snoozes);
                broadcast();
                return send(res, 200, "");
            }
            const seenSession = /^\/sessions\/([^/]+)\/seen$/.exec(url.pathname);
            if (req.method === "POST" && seenSession) {
                const id = decodeURIComponent(seenSession[1]);
                if (!isSafe(id)) return send(res, 400, "bad session id");
                markSeen(id);
                broadcast();
                return send(res, 200, "");
            }
            const ask = /^\/blocks\/([^/]+)\/ask$/.exec(url.pathname);
            if (req.method === "POST" && ask) {
                const blockId = decodeURIComponent(ask[1]);
                const b = (await body(req)) as { kind?: unknown; text?: unknown };
                const text = typeof b?.text === "string" ? b.text.trim() : "";
                if (!isSafe(blockId) || !isAskKind(b?.kind) || (text && (!isSafe(text) || text.length > MAX_TITLE)))
                    return send(res, 400, `need kind: answer, decide, approve or unblock, and an optional one-line text up to ${MAX_TITLE} characters`);
                const card = askCard(b as Parameters<typeof askCard>[0]);
                if (typeof card === "string") return send(res, 400, card);
                sessions = askSession(sessions, blockId, b.kind, text || undefined, Date.now(), sid, card);
                saveSessions();
                broadcast();
                return send(res, 200, "");
            }
            const done = /^\/blocks\/([^/]+)\/done$/.exec(url.pathname);
            if (req.method === "POST" && done) {
                const blockId = decodeURIComponent(done[1]);
                if (!isSafe(blockId)) return send(res, 400, "bad block id");
                sessions = finishSession(sessions, blockId, Date.now(), sid);
                saveSessions();
                broadcast();
                return send(res, 200, "");
            }
            // Shelved sessions that can't be resumed (never prompted, so no conversation) come off.
            if (req.method === "POST" && url.pathname === "/shelf/forget") {
                const b = (await body(req)) as { sessionIds?: unknown };
                if (!Array.isArray(b?.sessionIds) || !b.sessionIds.every(isSafe)) return send(res, 400, "need sessionIds: [<session id>, …]");
                saveShelf((b.sessionIds as string[]).reduce((sh, id) => unshelve(sh, id), shelf));
                broadcast();
                return send(res, 200, "");
            }
            const closeHeadsUp = /^\/headsups\/([^/]+)\/dismiss$/.exec(url.pathname);
            if (req.method === "POST" && closeHeadsUp) {
                const next = dismiss(headsUps, decodeURIComponent(closeHeadsUp[1]));
                if (next === headsUps) return send(res, 404, "no such heads-up");
                headsUps = next;
                writeJsonAtomic(headsFile, headsUps);
                broadcast();
                return send(res, 200, "");
            }
            // A one-off rebuild of PR ownership (from the sessions' transcripts): url → session id, or null.
            if (req.method === "POST" && url.pathname === "/prs/owners") {
                const b = (await body(req)) as { owners?: unknown; touched?: unknown };
                const owners = b?.owners;
                const touched = b?.touched ?? {};
                const valid =
                    owners && typeof owners === "object" && Object.entries(owners).every(([u, id]) => PR_URL.test(u) && (id === null || isSafe(id))) &&
                    typeof touched === "object" && Object.entries(touched as object).every(([id, urls]) => isSafe(id) && Array.isArray(urls) && urls.every((u) => typeof u === "string" && PR_URL.test(u)));
                if (!valid) return send(res, 400, "need owners: { <PR url>: <session id> | null }, and touched: { <session id>: [<PR url>, …] }");
                const r = reassignPrs(sessions, shelf, owners as Record<string, string | null>, touched as Record<string, string[]>);
                sessions = r.sessions;
                saveSessions();
                saveShelf(r.shelf);
                broadcast();
                return send(res, 200, "");
            }
            // The main process, every half minute: how long the Mac has had no input.
            if (req.method === "POST" && url.pathname === "/rhythm/idle") {
                const b = (await body(req)) as { idleMs?: unknown };
                if (typeof b?.idleMs !== "number" || !(b.idleMs >= 0)) return send(res, 400, "need idleMs, a number");
                const now = Date.now();
                setRhythm(tick(rhythm, b.idleMs, now, localDay(now)));
                lastIdleMs = b.idleMs;
                countTime(now, b.idleMs);
                return send(res, 200, "");
            }
            // The UI, whenever the focused pane or the window's focus changes: the session you are at, or none.
            if (req.method === "POST" && url.pathname === "/focus") {
                const b = (await body(req)) as { sessionId?: unknown };
                if (b?.sessionId !== null && !isSafe(b?.sessionId)) return send(res, 400, "need sessionId, a session's id or null");
                // Each visible window reports every few seconds: the same session again changes nothing.
                if (focused?.sessionId === b.sessionId || (!focused && b.sessionId === null)) return send(res, 200, "");
                logEvent("focus", { id: b.sessionId });
                const now = Date.now();
                if (focused) countTime(now, lastIdleMs);
                focused = typeof b.sessionId === "string" ? { sessionId: b.sessionId, since: now } : undefined;
                return send(res, 200, "");
            }
            // Estimated time for the days before logging began; what the log already has stays.
            if (req.method === "POST" && url.pathname === "/time/backfill") {
                const b = (await body(req)) as { log?: unknown };
                const ok = b?.log && typeof b.log === "object" && Object.entries(b.log as object).every(([day, ss]) => /^\d{4}-\d{2}-\d{2}$/.test(day) && ss && typeof ss === "object" && Object.values(ss as object).every((e) => typeof e?.ms === "number" && (e.epic === undefined || isSafe(e.epic))));
                if (!ok) return send(res, 400, "need log: { YYYY-MM-DD: { sessionId: { epic?, ms } } }");
                timeLog = mergeBackfill(timeLog, b.log as TimeLog);
                writeJsonAtomic(timeFile, timeLog);
                return send(res, 200, "");
            }
            // Your own correction of one epic's time in a month (the report's ⏎), never the log itself.
            if (req.method === "POST" && url.pathname === "/time/adjust") {
                const b = (await body(req)) as { month?: unknown; epic?: unknown; ms?: unknown };
                if (typeof b?.month !== "string" || !/^\d{4}-\d{2}$/.test(b.month) || typeof b.ms !== "number" || !Number.isFinite(b.ms) || (b.epic !== null && !isSafe(b.epic)))
                    return send(res, 400, "need month YYYY-MM, epic (or null) and ms");
                timeLog = adjustMonth(timeLog, b.month, typeof b.epic === "string" ? b.epic : undefined, Math.round(b.ms));
                writeJsonAtomic(timeFile, timeLog);
                return send(res, 200, "");
            }
            // An epic's page: its time over the last eight workdays, and every session that worked in
            // it, live or not, with its name, time and PRs.
            const epicHist = /^\/epics\/([^/]+)\/history$/.exec(url.pathname);
            if (req.method === "GET" && epicHist) {
                const id = decodeURIComponent(epicHist[1]);
                const h = epicHistory(timeLog, id, lastWorkdays(new Date(), 8));
                const shelved = Object.values(shelf).flat();
                const steps = h.sessions.filter((x) => !x.sessionId.startsWith("adjust:")).map((x) => {
                    const live = sessions.get(x.sessionId);
                    const item = shelved.find((i) => i.sessionId === x.sessionId);
                    return { ...x, name: live?.name?.text ?? item?.named?.text ?? live?.label ?? item?.label ?? recapper.gistOf(x.sessionId) ?? "a session", prs: live?.prs ?? item?.prs ?? [], live: !!live && live.state !== "ended" };
                });
                return json(res, { days: h.days, steps });
            }
            // The month's meeting time from your calendar, for the report. The calendar's address is a
            // secret: it is never printed, not even in an error. Read at most every ten minutes.
            if (req.method === "GET" && url.pathname === "/time/meetings") {
                const month = url.searchParams.get("month") ?? "";
                if (!/^\d{4}-\d{2}$/.test(month)) return send(res, 400, "need month=YYYY-MM");
                if (!opts.calendarIcs) return send(res, 404, "no calendar: set WINTOS_CALENDAR_ICS");
                const cached = meetingCache.get(month);
                if (cached && Date.now() - cached.at < 600_000) return json(res, { ms: cached.ms });
                try {
                    const r = await fetch(opts.calendarIcs, { signal: AbortSignal.timeout(30_000) });
                    if (!r.ok) return send(res, 502, `the calendar answered ${r.status}`);
                    const [y, m] = month.split("-").map(Number);
                    const ms = meetingMs(icsToMeetings(await r.text(), new Date(y, m - 1, 1).getTime(), new Date(y, m, 1).getTime()));
                    meetingCache.set(month, { ms, at: Date.now() });
                    return json(res, { ms });
                } catch {
                    return send(res, 502, "could not read the calendar");
                }
            }
            if (req.method === "GET" && url.pathname === "/time/month") {
                const month = url.searchParams.get("month") ?? "";
                if (!/^\d{4}-\d{2}$/.test(month)) return send(res, 400, "need month=YYYY-MM");
                // Beside each epic's time: the PRs its sessions own (live or shelved), and your correction.
                const shelved = Object.values(shelf).flat();
                const prsOf = (sid: string) => sessions.get(sid)?.prs ?? shelved.find((i) => i.sessionId === sid)?.prs ?? [];
                const inMonth = Object.entries(timeLog).filter(([d]) => d.startsWith(`${month}-`));
                return json(res, monthByEpic(timeLog, month).map((r) => {
                    const sids = inMonth.flatMap(([, ss]) => Object.entries(ss).filter(([, e]) => e.epic === r.epic).map(([sid]) => sid));
                    const adjusted = timeLog[`${month}-01`]?.[`adjust:${r.epic ?? "none"}`]?.ms ?? 0;
                    return { ...r, prs: new Set(sids.flatMap(prsOf)).size, adjusted };
                }));
            }
            if (req.method === "POST" && url.pathname === "/epics") {
                const b = (await body(req)) as { title?: unknown; short?: unknown; lane?: unknown; agent?: unknown };
                const title = typeof b?.title === "string" ? b.title.trim() : "";
                const short = typeof b?.short === "string" ? b.short.trim() : "";
                if (!title || !isSafe(title) || title.length > EPIC_TITLE_MAX || (short && (!isSafe(short) || short.length > SHORT_MAX)) || (b.lane !== undefined && !isSafe(b.lane)) || (b.agent !== undefined && !isSafe(b.agent)))
                    return send(res, 400, `need a one-line title up to ${EPIC_TITLE_MAX} characters, and an optional short name up to ${SHORT_MAX}`);
                // agent: a session promoted to be the new epic's agent. A background session gets no
                // WintOS context, so it could not act as one.
                const agent = typeof b.agent === "string" ? sessions.get(b.agent) : undefined;
                if (b.agent !== undefined && (!agent || agent.state === "ended" || agent.background)) return send(res, 409, "the agent must be a live session in a pane");
                if (agent && epics.list().some((x) => !x.done && x.agent === agent.id)) return send(res, 409, "that session is already an epic's agent");
                const e = epics.create(title, { ...(short ? { short } : {}), ...(typeof b.lane === "string" ? { lane: b.lane } : {}), ...(agent ? { agent: agent.id } : {}) });
                if (agent) {
                    sessions = setEpic(sessions, agent.id, e.id);
                    saveSessions();
                    reports = addReport(reports, agent.id, promotedNote(e.title), Date.now());
                    writeJsonAtomic(reportsFile, reports);
                    logEvent("promote", { agent: agent.id, epic: e.id });
                }
                broadcast();
                return send(res, 200, e.id);
            }
            // `wintos epic <name>` names it from inside its pane; the UI (⌥⌘E) by the session's id.
            const epicOfBlock = /^\/blocks\/([^/]+)\/epic$/.exec(url.pathname);
            const epicOfSession = /^\/sessions\/([^/]+)\/epic$/.exec(url.pathname);
            if (req.method === "POST" && (epicOfBlock || epicOfSession)) {
                const b = (await body(req)) as { epic?: unknown };
                if (b?.epic !== null && (typeof b?.epic !== "string" || !b.epic.trim() || !isSafe(b.epic))) return send(res, 400, "need epic: a name, or null for none");
                const s = epicOfBlock ? liveIn(sessions, decodeURIComponent(epicOfBlock[1]), sid) : sessions.get(decodeURIComponent(epicOfSession![1]));
                if (!s) return send(res, 409, "no session in this pane");
                // An agent leaving its epic by itself would keep the role in name only (⌥⌘E is yours to move it).
                if (epicOfBlock && epics.list().some((e) => !e.done && e.agent === s.id)) return send(res, 409, "an epic's agent stays in its epic; the developer moves it with ⌥⌘E");
                const open = epics.list().filter((e) => !e.done);
                const epic = b.epic === null ? undefined : epicOfBlock ? findEpic(open, b.epic as string) : open.find((e) => e.id === b.epic);
                if (b.epic !== null && !epic)
                    return send(res, 404, `no epic matches ${b.epic}; ${open.length ? `open epics: ${open.map((e) => `${e.title} (${e.id})`).join(", ")}` : "there are no epics yet"}`);
                // Out of an epic, it is no longer its agent nor linked to its steps (STATE-7).
                for (const old of open.filter((e) => e.id !== epic?.id && (e.agent === s.id || Object.values(e.links ?? {}).some((ids) => ids.includes(s.id)))))
                    epics.update(old.id, ({ agent, links, ...rest }) => {
                        const kept = Object.fromEntries(Object.entries(links ?? {}).map(([k, ids]) => [k, ids.filter((x) => x !== s.id)]).filter(([, ids]) => ids.length));
                        return { ...rest, ...(agent && agent !== s.id ? { agent } : {}), ...(Object.keys(kept).length ? { links: kept } : {}) };
                    });
                sessions = setEpic(sessions, s.id, epic?.id);
                saveSessions();
                writeWorked();
                broadcast();
                return send(res, 200, epic?.title ?? "none");
            }
            if (req.method === "POST" && url.pathname === "/rhythm/break") return setRhythm(startBreak(rhythm, Date.now())), send(res, 200, "");
            if (req.method === "POST" && url.pathname === "/rhythm/snooze") {
                const b = (await body(req)) as { minutes?: unknown };
                if (typeof b?.minutes !== "number" || !(b.minutes > 0 && b.minutes <= 240)) return send(res, 400, "need minutes, 1 to 240");
                setRhythm(snooze(rhythm, Date.now(), b.minutes));
                return send(res, 200, "");
            }
            if (req.method === "POST" && url.pathname === "/update") {
                if (!update?.repo || !update.behind()) return send(res, 409, "nothing to update: the checkout has no commits the running WintOS lacks");
                (opts.restart ?? ((repo) => restartWintos(repo, port !== DEFAULT_PORT)))(update.repo);
                return send(res, 202, "");
            }
            if (req.method === "POST" && url.pathname === "/fixer/settings") {
                const b = (await body(req)) as { conflicts?: unknown };
                if (typeof b?.conflicts !== "boolean") return send(res, 400, "need conflicts: true or false");
                fixer.setConflicts(b.conflicts);
                return send(res, 200, "");
            }
            // Red CI, dispatched from the PRs tab: the same route an automatic run would take.
            if (req.method === "POST" && url.pathname === "/fixer/ci") {
                const b = (await body(req)) as { url?: unknown };
                const pr = ghData()?.prs.find((p) => p.url === b?.url);
                if (!pr) return send(res, 404, "no such PR in the PR list");
                if (pr.checks !== "FAILURE" && pr.checks !== "ERROR") return send(res, 409, "its CI is not red");
                const job = fixJob(pr, [...sessions.values()], shelf);
                const run = fixer.start(job);
                return json(res, { run, ...(job.route.kind === "pane" ? { blockId: job.route.blockId, tabId: job.route.tabId, prompt: fixPrompt(job) } : {}) });
            }
            // f in the PRs tab: the row's next step. A first review needs you in it, so the window opens
            // it as a session of its own; so does a re-review no session holds.
            if (req.method === "POST" && url.pathname === "/fixer/next") {
                const b = (await body(req)) as { url?: unknown };
                const gh = ghData();
                const pr = gh?.prs.find((p) => p.url === b?.url);
                if (!gh || !pr) return send(res, 404, "no such PR in the PR list");
                const kind = nextAction(pr, gh.me, groupOf(pr, gh.me, Date.now()));
                if (!kind) return send(res, 409, "nothing to do for it but wait");
                if (kind === "review") return json(res, { review: true });
                const job: FixJob = kind === "conflict" ? { kind, pr, route: { kind: "fresh" } } : fixJob(pr, [...sessions.values()], shelf, kind);
                if (kind === "rereview" && job.route.kind === "fresh") return json(res, { review: true });
                const run = fixer.start(job);
                return json(res, { run, ...(job.route.kind === "pane" ? { blockId: job.route.blockId, tabId: job.route.tabId, prompt: fixPrompt(job) } : {}) });
            }
            // Coming back to a session after a while: what you asked, what it did, what it needs.
            const back = /^\/sessions\/([^/]+)\/reentry$/.exec(url.pathname);
            if (req.method === "GET" && back) {
                const s = sessions.get(decodeURIComponent(back[1]));
                if (!s) return send(res, 404, "no such session");
                const tp = recapper.transcriptOf(s.id);
                let text = "";
                try {
                    if (tp) text = readFileSync(tp, "utf8");
                } catch {}
                return json(res, reentry(s, userPrompts(text), recapper.gistOf(s.id), lastReply(text)));
            }
            const unpark = /^\/sessions\/([^/]+)\/unpark$/.exec(url.pathname);
            if (req.method === "POST" && unpark) {
                // A pause a wake made ends the wake too: the two say the same thing.
                const s = sessions.get(decodeURIComponent(unpark[1]));
                const own = Object.entries(wakes).filter(([, w]) => w.sessionId === s?.id && waitingOn(w) === s?.parkedOn);
                if (own.length) (wakes = Object.fromEntries(Object.entries(wakes).filter(([k]) => !own.some(([o]) => o === k)))), saveWakes();
                sessions = unparkSession(sessions, decodeURIComponent(unpark[1]), Date.now());
                saveSessions();
                broadcast();
                return send(res, 200, "");
            }
            const wait = /^\/blocks\/([^/]+)\/wait$/.exec(url.pathname);
            if (req.method === "POST" && wait) {
                const blockId = decodeURIComponent(wait[1]);
                const b = (await body(req)) as { reason?: unknown };
                const reason = typeof b?.reason === "string" ? b.reason.trim() : "";
                if (!isSafe(blockId) || !reason || !isSafe(reason) || reason.length > MAX_TITLE)
                    return send(res, 400, `need a one-line reason up to ${MAX_TITLE} characters`);
                sessions = parkSession(sessions, blockId, reason, Date.now(), sid);
                saveSessions();
                broadcast();
                return send(res, 200, "");
            }
            // `wintos name`: the session names itself. ⌘R: you rename it, or take its suggestion.
            const named = /^\/blocks\/([^/]+)\/name$/.exec(url.pathname);
            const renamed = /^\/sessions\/([^/]+)\/name(\/accept)?$/.exec(url.pathname);
            if (req.method === "POST" && (named || renamed)) {
                const accept = !!renamed?.[2];
                const b = (await body(req)) as { text?: unknown };
                const text = typeof b?.text === "string" ? b.text.trim() : "";
                if (!accept && (!text || !isSafe(text) || text.length > MAX_NAME)) return send(res, 400, `need a one-line name up to ${MAX_NAME} characters`);
                const now = Date.now();
                if (named) sessions = nameSession(sessions, decodeURIComponent(named[1]), text, now, sid);
                else sessions = accept ? acceptSuggestedName(sessions, decodeURIComponent(renamed![1]), now) : renameSession(sessions, decodeURIComponent(renamed![1]), text, now);
                saveSessions();
                writeWorked();
                broadcast();
                return send(res, 200, "");
            }
            const status = /^\/blocks\/([^/]+)\/status$/.exec(url.pathname);
            if (req.method === "POST" && status) {
                const blockId = decodeURIComponent(status[1]);
                const b = (await body(req)) as { text?: unknown };
                const text = typeof b?.text === "string" ? b.text.trim() : "";
                if (!isSafe(blockId) || !text || !isSafe(text) || text.length > MAX_STATUS)
                    return send(res, 400, `need a one-line status up to ${MAX_STATUS} characters`);
                sessions = setStatus(sessions, blockId, text, Date.now(), sid);
                saveSessions();
                broadcast();
                return send(res, 200, "");
            }
            const lane = /^\/blocks\/([^/]+)\/lane$/.exec(url.pathname);
            if (req.method === "POST" && lane) {
                const blockId = decodeURIComponent(lane[1]);
                const b = (await body(req)) as { name?: unknown; steps?: unknown };
                const steps = Array.isArray(b?.steps) ? b.steps.map((s) => (typeof s === "string" ? s.trim() : "")) : [];
                const ok = isSafe(blockId) && isSafe(b?.name) && b.name.length <= MAX_STEP && steps.length > 0 && steps.length <= MAX_STEPS && steps.every((s) => s && isSafe(s) && s.length <= MAX_STEP);
                if (!ok) return send(res, 400, `need a lane name and 1-${MAX_STEPS} one-line steps up to ${MAX_STEP} characters`);
                sessions = setLane(sessions, blockId, b.name as string, steps, sid);
                const laned = liveIn(sessions, blockId, sid);
                if (laned) placeInEpic(laned.id);
                saveSessions();
                broadcast();
                return send(res, 200, "");
            }
            // `wintos wake`: the session's next step, typed into it when a PR reaches an event.
            const wake = /^\/blocks\/([^/]+)\/wake(\/cancel)?$/.exec(url.pathname);
            if (req.method === "POST" && wake) {
                const live = liveIn(sessions, decodeURIComponent(wake[1]), sid);
                if (!live) return send(res, 400, "no live Claude session in this pane: run wintos wake from the session that should continue");
                if (wake[2]) {
                    const gone = Object.values(wakes).filter((w) => w.sessionId === live.id);
                    const had = gone.length > 0;
                    wakes = Object.fromEntries(Object.entries(wakes).filter(([, w]) => w.sessionId !== live.id));
                    saveWakes();
                    if (endWakePause(gone)) saveSessions("its wakes were cancelled");
                    broadcast();
                    return send(res, 200, had ? "cancelled" : "no wake was set");
                }
                const b = (await body(req)) as { until?: unknown; pr?: unknown; prompt?: unknown };
                const link = typeof b?.pr === "string" ? prLink(b.pr) : undefined;
                const prompt = typeof b?.prompt === "string" ? b.prompt.trim() : "";
                if (!isWakeEvent(b?.until)) return send(res, 400, `unknown event ${JSON.stringify(b?.until ?? "")}: use one of ${WAKE_EVENTS.join(", ")} (green: its CI passed; merged: merged into its base; released: its merge is on main; rereview: you or your team are asked to review it again; comments: someone reviewed or commented on it)`);
                if (!link) return send(res, 400, `can't read the PR ${JSON.stringify(b?.pr ?? "")}: give its link (https://github.com/owner/repo/pull/123) or owner/repo#123`);
                if (!prompt || prompt.length > MAX_PROMPT) return send(res, 400, `need the prompt to continue with, up to ${MAX_PROMPT} characters: what you will do once it happens, written as an instruction to yourself`);
                const now = Date.now();
                const w = { sessionId: live.id, pr: link, until: b.until, prompt, at: now, expires: expiresAt(now) };
                wakes = { ...wakes, [wakeId(w)]: w };
                saveWakes();
                sessions = parkSession(sessions, live.blockId, waitingOn(w), now, live.id);
                saveSessions();
                broadcast();
                void checkWakes();
                return json(res, w);
            }
            // The window saw a pane resuming this session (`claude attach` while it runs in the
            // background service): it shows there.
            const attach = /^\/sessions\/([^/]+)\/attach$/.exec(url.pathname);
            if (req.method === "POST" && attach) {
                const b = (await body(req)) as { tabId?: unknown; blockId?: unknown };
                if (!isSafe(b?.tabId) || !isSafe(b?.blockId)) return send(res, 400, "need tabId and blockId");
                sessions = attachSession(sessions, decodeURIComponent(attach[1]), b.tabId as string, b.blockId as string);
                saveSessions();
                broadcast();
                return send(res, 200, "");
            }
            // The window that typed a due wake into its pane: once only, whichever window asks first.
            const delivered = /^\/wakes\/([^/]+)\/delivered$/.exec(url.pathname);
            if (req.method === "POST" && delivered) {
                const id = decodeURIComponent(delivered[1]);
                if (!wakes[id]?.due) return send(res, 409, "no such wake due");
                delete wakes[id];
                saveWakes();
                broadcast();
                return send(res, 200, "");
            }
            const claimed = /^\/blocks\/([^/]+)\/pr$/.exec(url.pathname);
            if (req.method === "POST" && claimed) {
                const blockId = decodeURIComponent(claimed[1]);
                const b = (await body(req)) as { ref?: unknown; own?: unknown };
                const link = typeof b?.ref === "string" ? prLink(b.ref) : undefined;
                if (!isSafe(blockId) || !link) return send(res, 400, "need a PR link or owner/repo#number");
                const live = liveIn(sessions, blockId, sid);
                if (!live) return send(res, 400, "no live session in this pane");
                applyTouch(touchPrs(sessions, shelf, live.id, [link], b.own === true));
                saveSessions();
                broadcast();
                return send(res, 200, link);
            }
            // `wintos unit`: the project's units of work, by the session in this pane.
            const unit = /^\/blocks\/([^/]+)\/units$/.exec(url.pathname);
            if (req.method === "POST" && unit) {
                const blockId = decodeURIComponent(unit[1]);
                const b = (await body(req)) as { items?: unknown; start?: unknown; done?: unknown; rename?: { from?: unknown; to?: unknown }; move?: { name?: unknown; by?: unknown }; remove?: unknown };
                const okName = (s: unknown): s is string => typeof s === "string" && !!s.trim() && isSafe(s) && !s.includes("|") && s.trim().length <= UNIT_MAX;
                // Rename, move, remove: an epic's roadmap edited step by step, its sessions kept with their steps.
                const stepEdit = b?.rename ?? b?.move ?? b?.remove;
                if (stepEdit !== undefined) {
                    const live = liveIn(sessions, blockId, sid);
                    const epic = live?.epic ? epics.byId(live.epic) : undefined;
                    if (!live || !epic) return send(res, 409, "rename, move and remove are for an epic's roadmap; this session is in no epic");
                    const want = (q: unknown) => (typeof q === "string" && unitIndex(epic.steps, q) >= 0 ? epic.steps[unitIndex(epic.steps, q)].name : undefined);
                    const op: RoadmapOp | undefined = b.rename ? (want(b.rename.from) && typeof b.rename.to === "string" ? { rename: { from: want(b.rename.from)!, to: b.rename.to } } : undefined) : b.move ? (want(b.move.name) && (b.move.by === 1 || b.move.by === -1) ? { move: { name: want(b.move.name)!, by: b.move.by } } : undefined) : want(b.remove) ? { remove: want(b.remove)! } : undefined;
                    if (!op) return send(res, 404, `no such step; the roadmap: ${epic.steps.map((u) => u.name).join(" · ") || "empty"}`);
                    const r = editRoadmap({ steps: epic.steps, links: epic.links ?? {} }, op);
                    if (typeof r === "string") return send(res, 400, r);
                    epics.update(epic.id, ({ links: _, ...e }) => ({ ...e, steps: r.steps, ...(Object.keys(r.links).length ? { links: r.links } : {}) }));
                    if (r.note) logEvent("roadmap", { epic: epic.id, by: live.id, note: r.note });
                    broadcast();
                    return send(res, 200, serializeUnits(r.steps));
                }
                const items = Array.isArray(b?.items) ? b.items : undefined;
                const okItems = !!items && items.length > 0 && items.length <= UNITS_MAX && items.every(okName);
                if (!isSafe(blockId) || (!okItems && !okName(b?.start) && !okName(b?.done)))
                    return send(res, 400, `need 1-${UNITS_MAX} units of one line up to ${UNIT_MAX} characters, without |; or the one to start or mark done`);
                const live = liveIn(sessions, blockId, sid);
                if (!live) return send(res, 409, "no session in this pane");
                const change = (was: Unit[]) => (okItems ? setUnits(was, (items as string[]).map((s) => s.trim())) : okName(b.start) ? startUnit(was, b.start) : doneUnit(was, b.done as string));
                // A session in an epic moves the epic's roadmap, which every session in it shares. Setting
                // the whole list is the agent's: from a step's session it would drop the other steps' links.
                const epic = live.epic ? epics.byId(live.epic) : undefined;
                if (epic && okItems && epic.agent !== live.id) return send(res, 403, "the epic's agent keeps the roadmap; a session starts and finishes its step: wintos unit start|done <step>");
                if (epic) {
                    // The epic's agent moves the roadmap; it is no step's session, so it is never linked.
                    const linked = okName(b.start) && !okItems && live.id !== epic.agent ? linkStep({ steps: epic.steps, links: epic.links ?? {} }, b.start, live.id) : undefined;
                    const next = linked?.steps ?? change(epic.steps);
                    if (!next) return send(res, 400, "no such step in the epic's roadmap; wintos unit <unit>… sets it");
                    const links = pruneLinks(linked?.links ?? epic.links ?? {}, next);
                    epics.update(epic.id, ({ links: _, ...e }) => ({ ...e, steps: next, ...(Object.keys(links).length ? { links } : {}) }));
                    logEvent("roadmap", { epic: epic.id, by: live.id, steps: serializeUnits(next) });
                    broadcast();
                    return send(res, 200, serializeUnits(next));
                }
                const r = store.updateUnits(live.tabId, change);
                if (typeof r === "string") return send(res, r === "no project" ? 409 : 400, r === "no project" ? "this pane's project has no project.md yet; name it with wintos title first" : "no such unit; wintos unit <unit>… sets the list");
                broadcast();
                return send(res, 200, serializeUnits(r));
            }
            // The epic agent passes what you told it on to one of its sessions (wintos relay), or puts its
            // recommendation on a session's open question (wintos suggest) instead of asking it again.
            const agentTo = /^\/blocks\/([^/]+)\/(relay|suggest|tell)$/.exec(url.pathname);
            if (req.method === "POST" && agentTo) {
                const b = (await body(req)) as { to?: unknown; text?: unknown; note?: unknown };
                const blockId = decodeURIComponent(agentTo[1]);
                if (!isSafe(blockId) || !isSafe(b?.to) || typeof b.text !== "string" || !b.text.trim() || b.text.length > 2000 || (b.note !== undefined && (!isSafe(b.note) || b.note.length > MAX_STATUS)))
                    return send(res, 400, `need to (a session), text up to 2000 characters, and a one-line note up to ${MAX_STATUS}`);
                const live = liveIn(sessions, blockId, sid);
                const epic = live?.epic ? epics.byId(live.epic) : undefined;
                if (!live || !epic || epic.agent !== live.id) return send(res, 403, "only an epic's agent passes things on to its sessions");
                const to = findWorker([...sessions.values()], epic.id, live.id, b.to, epic.links);
                if (!to) {
                    const names = [...sessions.values()].filter((x) => x.epic === epic.id && x.id !== live.id && x.state !== "ended").map((x) => x.name?.text ?? x.label ?? x.id.slice(0, 8));
                    return send(res, 404, `no single open session in the epic matches (name one by more of its name); its sessions: ${names.join(", ") || "none"}`);
                }
                if (agentTo[2] === "suggest") {
                    if (!to.ask) return send(res, 409, "that session asks nothing now");
                    sessions = new Map(sessions).set(to.id, { ...to, ask: { ...to.ask, suggestion: b.text.trim() } });
                    saveSessions("wintos suggest");
                    logEvent("suggest", { agent: live.id, to: to.id, text: b.text.trim() });
                    broadcast();
                    return send(res, 200, to.name?.text ?? to.label ?? to.id);
                }
                if (agentTo[2] === "tell") {
                    saveRelays(addRelay(relays, to.id, { text: b.text.trim(), from: live.id, at: Date.now(), own: true }));
                    logEvent("tell", { agent: live.id, to: to.id, text: b.text.trim() });
                    if (to.bgId) setTimeout(() => void pollBg(), 2_000);
                    broadcast();
                    return send(res, 200, to.name?.text ?? to.label ?? to.id);
                }
                if (!(saidTo[live.id] ?? []).some((said) => youSaid(said, b.text as string))) return send(res, 403, "only words the developer said to you go through: quote them from one of their last prompts; your own words go in --note");
                saveRelays(addRelay(relays, to.id, { text: b.text.trim(), ...(typeof b.note === "string" && b.note.trim() ? { note: b.note.trim() } : {}), from: live.id, at: Date.now() }));
                logEvent("relay", { agent: live.id, to: to.id, text: b.text.trim(), note: b.note });
                if (to.bgId) setTimeout(() => void pollBg(), 2_000);
                broadcast();
                // A restored session's Claude starts only when its pane is opened: the agent says so.
                return send(res, 200, `${to.name?.text ?? to.label ?? to.id}${to.restored ? " (not started: it gets this when the developer opens it)" : ""}`);
            }
            // `wintos adopt <session>`: a session in no epic joins the agent's (one in another epic stays
            // there: moving it is the developer's call). `wintos stop <session>`: one the agent started
            // in the background stops.
            const agentAct = /^\/blocks\/([^/]+)\/(adopt|stop|rename)$/.exec(url.pathname);
            if (req.method === "POST" && agentAct) {
                const b = (await body(req)) as { to?: unknown; name?: unknown };
                const live = liveIn(sessions, decodeURIComponent(agentAct[1]), sid);
                const epic = live?.epic ? epics.byId(live.epic) : undefined;
                if (!live || !epic || epic.agent !== live.id) return send(res, 403, "only an epic's agent does this");
                if (!isSafe(b?.to)) return send(res, 400, "need to, a session");
                if (agentAct[2] === "adopt") {
                    const to = findWorker([...sessions.values()], undefined, live.id, b.to);
                    if (!to) return send(res, 404, "no open session in no epic matches; one in another epic stays there, the developer moves it");
                    sessions = setEpic(sessions, to.id, epic.id);
                    saveSessions("wintos adopt");
                    logEvent("adopt", { agent: live.id, epic: epic.id, to: to.id });
                    broadcast();
                    return send(res, 200, to.name?.text ?? to.label ?? to.id);
                }
                // `wintos rename <session> <name>`: one of its sessions renamed, as a session names itself:
                // a name the developer gave stays, the agent's waits beside it as a suggestion.
                if (agentAct[2] === "rename") {
                    const to = findWorker([...sessions.values()], epic.id, live.id, b.to, epic.links);
                    if (!to) return send(res, 404, "no open session in the epic matches");
                    if (typeof b.name !== "string" || !isSafe(b.name) || !b.name.trim() || b.name.length > 60) return send(res, 400, "need name, one line up to 60 characters");
                    sessions = nameSession(sessions, to.blockId, b.name.trim(), Date.now(), to.id);
                    saveSessions("wintos rename");
                    broadcast();
                    return send(res, 200, sessions.get(to.id)?.name?.by === "you" ? `${to.name?.text}: the developer named it, so "${b.name.trim()}" waits beside it as a suggestion` : b.name.trim());
                }
                const to = findWorker([...sessions.values()], epic.id, live.id, b.to, epic.links);
                if (!to?.bgId) return send(res, 404, "no session you started in the background matches; the developer closes the others");
                if (!(await bgStop(to.bgId))) return send(res, 502, "claude stop failed");
                sessions = new Map(sessions).set(to.id, { ...to, state: "ended", since: Date.now(), lastAt: Date.now() });
                saveSessions("wintos stop");
                logEvent("bg-stop", { agent: live.id, to: to.id });
                broadcast();
                return send(res, 200, to.name?.text ?? to.id);
            }
            // `wintos peek <session>`: one of the epic's sessions beyond its digest line.
            const peek = /^\/blocks\/([^/]+)\/peek$/.exec(url.pathname);
            if (req.method === "POST" && peek) {
                const b = (await body(req)) as { to?: unknown };
                const live = liveIn(sessions, decodeURIComponent(peek[1]), sid);
                const epic = live?.epic ? epics.byId(live.epic) : undefined;
                if (!live || !epic || epic.agent !== live.id) return send(res, 403, "only an epic's agent peeks at its sessions");
                if (!isSafe(b?.to)) return send(res, 400, "need to, a session");
                const to = findWorker([...sessions.values()], epic.id, live.id, b.to, epic.links);
                if (!to) return send(res, 404, "no open session in the epic matches");
                const step = Object.entries(epic.links ?? {}).find(([, ids]) => ids.includes(to.id))?.[0];
                const prs = (to.prs ?? []).map((u) => ({ url: u, state: donePrs[u] ? (donePrs[u].merged ? "merged" : "closed") : "open or unknown" }));
                const tp = transcripts.get(to.id);
                const reply = to.bgId && !to.attachedTo ? await bgLogs(to.bgId) : tp ? lastReplyIn(readTail(tp) ?? "") : undefined;
                return send(res, 200, peekText(to, { step, prs, reply }));
            }
            // `wintos start`: the epic agent starts a session for a roadmap step in the background.
            // check: before it runs `claude --bg`, may it, and under what name; then bgId: it did.
            const bgStart = /^\/blocks\/([^/]+)\/start$/.exec(url.pathname);
            if (req.method === "POST" && bgStart) {
                const b = (await body(req)) as { step?: unknown; check?: unknown; bgId?: unknown };
                const live = liveIn(sessions, decodeURIComponent(bgStart[1]), sid);
                const epic = live?.epic ? epics.byId(live.epic) : undefined;
                if (!live || !epic || epic.agent !== live.id) return send(res, 403, "only an epic's agent starts sessions for its steps");
                const at = typeof b?.step === "string" ? unitIndex(epic.steps, b.step) : -1;
                const step = at >= 0 ? epic.steps[at] : undefined;
                if (!step) return send(res, 404, `no such step in the roadmap; its steps: ${epic.steps.map((u) => u.name).join(" · ") || "none, wintos unit sets them"}`);
                if (liveStarts(bgStarts, sessions, epic.id) >= BG_MAX) return send(res, 409, `${BG_MAX} sessions you started still run; wait for one to finish`);
                const name = `${epic.short ?? epic.title}: ${step.name}`.slice(0, 80);
                if (b.check === true) return send(res, 200, name);
                if (typeof b.bgId !== "string" || !BG_ID.test(b.bgId)) return send(res, 400, "need bgId, the short id claude --bg printed");
                bgStarts = { ...bgStarts, [b.bgId]: { epic: epic.id, step: step.name, name, agent: live.id, tabId: live.tabId, at: Date.now() } };
                writeJsonAtomic(bgFile, bgStarts);
                logEvent("bg-start", { agent: live.id, epic: epic.id, step: step.name, bgId: b.bgId });
                setTimeout(() => void pollBg(), 3_000);
                return send(res, 200, name);
            }
            const relayDone = /^\/sessions\/([^/]+)\/relays\/delivered$/.exec(url.pathname);
            if (req.method === "POST" && relayDone) {
                const b = (await body(req)) as { n?: unknown };
                if (typeof b?.n !== "number" || !(b.n >= 0)) return send(res, 400, "need n, how many were typed in");
                saveRelays(relaysDelivered(relays, decodeURIComponent(relayDone[1]), b.n));
                logEvent("relays-delivered", { to: decodeURIComponent(relayDone[1]), n: b.n });
                broadcast();
                return send(res, 200, "");
            }
            const todo = /^\/blocks\/([^/]+)\/todo$/.exec(url.pathname);
            if (req.method === "POST" && todo) {
                const blockId = decodeURIComponent(todo[1]);
                const b = (await body(req)) as { items?: unknown; done?: unknown };
                const items = Array.isArray(b?.items) ? b.items.map((s) => (typeof s === "string" ? s.trim() : "")) : undefined;
                const okItems = items && items.length > 0 && items.length <= MAX_STEPS && items.every((s) => s && isSafe(s) && s.length <= MAX_TODO);
                if (!isSafe(blockId) || (!okItems && !isSafe(b?.done))) return send(res, 400, `need 1-${MAX_STEPS} one-line to-dos up to ${MAX_TODO} characters, or the one done`);
                const next = okItems ? setTodo(sessions, blockId, items!, sid) : tickTodo(sessions, blockId, b.done as string, sid);
                if (!next) return send(res, 400, okItems ? "no session in this pane" : "no such to-do in this step");
                sessions = next;
                saveSessions();
                broadcast();
                return send(res, 200, "");
            }
            const step = /^\/blocks\/([^/]+)\/step$/.exec(url.pathname);
            if (req.method === "POST" && step) {
                const blockId = decodeURIComponent(step[1]);
                const b = (await body(req)) as { step?: unknown; note?: unknown };
                const note = typeof b?.note === "string" && b.note.trim() ? b.note.trim() : undefined;
                if (!isSafe(blockId) || !isSafe(b?.step) || (note !== undefined && (!isSafe(note) || note.length > MAX_STATUS)))
                    return send(res, 400, "need a step name and an optional one-line note");
                const next = setStep(sessions, blockId, b.step as string, note, sid);
                if (!next) return send(res, 400, "no such step in this session's lane; run wintos lane first");
                sessions = next;
                saveSessions();
                broadcast();
                return send(res, 200, "");
            }
            const title = /^\/projects\/([^/]+)\/title$/.exec(url.pathname);
            if (req.method === "POST" && title) {
                const tabId = decodeURIComponent(title[1]);
                const b = (await body(req)) as { title?: unknown; manual?: unknown };
                const t = typeof b?.title === "string" ? b.title.trim() : "";
                if (!isSafe(tabId) || !isSafe(t) || t.length > MAX_TITLE) return send(res, 400, `need a one-line title up to ${MAX_TITLE} characters`);
                const project = store.setTitle(tabId, t, { manual: b.manual === true });
                broadcast();
                return json(res, project);
            }
            send(res, 404, "not found");
        } catch (e) {
            send(res, e instanceof SyntaxError ? 400 : 500, String(e));
        }
    });

    // A WebSocket, not server-sent events: Chromium caps HTTP connections at 6 per host across
    // the whole app, and every cached Wave tab is its own renderer holding a stream open.
    const wss = new WebSocketServer({ noServer: true });
    server.on("upgrade", (req, socket, head) => {
        if (refusal(req) || new URL(req.url ?? "/", "http://x").pathname !== "/ws") {
            socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
            sockets.add(ws);
            ws.on("close", () => sockets.delete(ws));
            ws.send(JSON.stringify(state()));
        });
    });

    await new Promise<void>((resolve) => server.listen(opts.port, opts.host ?? "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
    runner.start();
    for (const d of opts.claudeDirs ?? []) watchStore(d);
    return {
        http: server,
        close: () => {
            watcher?.close();
            epicsWatcher?.close();
            journalWatcher?.close();
            for (const w of storeWatchers.values()) w.close();
            clearInterval(warmRecap);
            clearInterval(wakeTimer);
            clearInterval(bgTimer);
            update?.stop();
            runner.stop();
            clearTimeout(pending);
            for (const s of sockets) s.terminate();
            wss.close();
            server.close();
        },
    };
}

const isSafe = (v: unknown): v is string => typeof v === "string" && SAFE.test(v);

function body(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
        let data = "";
        req.setEncoding("utf8");
        req.on("data", (chunk: string) => {
            data += chunk;
            if (data.length > MAX_BODY) reject(new SyntaxError("body too large"));
        });
        req.on("end", () => {
            try {
                resolve(JSON.parse(data));
            } catch (e) {
                reject(e);
            }
        });
        req.on("error", reject);
    });
}

const send = (res: http.ServerResponse, code: number, text: string) => (res.writeHead(code), res.end(text));
const json = (res: http.ServerResponse, v: unknown) => (res.writeHead(200, { "Content-Type": "application/json" }), res.end(JSON.stringify(v)));

const PR_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;


// A PR as the session names it: its link, or owner/repo#number.
function prLink(ref: string): string | undefined {
    const url = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/.exec(ref.trim());
    const short = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(ref.trim());
    const m = url ?? short;
    return m ? `https://github.com/${m[1]}/pull/${m[2]}` : undefined;
}

// The daemon's own files (.sessions.json, .events/<day>.jsonl, .fixer/logs/…) are not notes: a
// change to them must not reload every note and broadcast, or each event line would.
export const isDaemonFile = (file: string) => file.split(/[\\/]/)[0].startsWith(".");
