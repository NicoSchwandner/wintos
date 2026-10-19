import { readFileSync, watch, writeFileSync, type FSWatcher } from "fs";
import http from "http";
import type { AddressInfo } from "net";
import { basename, join } from "path";
import { WebSocketServer, type WebSocket } from "ws";
import { injection } from "../inject";
import { Plugin, PluginRunner } from "../plugins/runner";
import type { Snoozes } from "../prs/group";
import { ProjectStore } from "../projects/store";
import type { Journal } from "../journal/journal";
import { formatMarkdown } from "../markdown";
import { dayRecapper } from "../recap/day";
import { prFact } from "../recap/recap";
import { emptyStats, recordClick, recordDayDone, recordKey, type KeyStats } from "../keyboard/keyboard";
import { releasePrs, resumedSession, shelve, unshelve, withTitle, type Shelf, type Shelved } from "../shelf/shelf";
import { titlePrompt, writeTitle } from "../shelf/title";
import { fixJob, fixPrompt } from "../fixer/plan";
import { reassignPrs } from "../prs/owners";
import type { PR } from "../prs/group";
import { Fixer } from "../fixer/runner";
import { namePrompt, nameKey, userPrompts } from "../sessions/naming";
import { finishSession, HookEvent, parkSession, reduceSession, restoreSessions, Session, setLane, setStatus, setStep, setTodo, tickTodo, claimPrs, endSessions, leavingFor, unparkSession, nameSession, renameSession, acceptSuggestedName, titleSession } from "../sessions/reduce";

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
// journal: a daily journal for the Today page; lunch: "HH:MM-HH:MM", never counted as free time.
export async function startServer(opts: { root: string; port: number; host?: string; uiOrigins?: string[]; plugins?: Plugin[]; token?: string; journal?: Journal; lunch?: string; workday?: string; recapCmd?: string; recapExtra?: string; fixCmd?: string; fixCwd?: string }): Promise<WintosServer> {
    const store = new ProjectStore(opts.root);
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
    const uiOrigins = new Set(opts.uiOrigins ?? [...DEFAULT_UI_ORIGINS, ...(process.env.WINTOS_UI_ORIGINS?.split(",") ?? [])]);
    // Saved on every change and restored at start, so a restart doesn't forget who waits on you.
    const sessionFile = join(opts.root, ".sessions.json");
    let sessions = restoreSessions(readJson<Session[]>(sessionFile, []), Date.now());
    const saveSessions = () => writeFileSync(sessionFile, JSON.stringify([...sessions.values()]));
    // When the developer last looked at each project: a reply after that is unread.
    const seenFile = join(opts.root, ".seen.json");
    const seen = readJson<Record<string, number>>(seenFile, {});
    const markSeen = (id: string) => ((seen[id] = Date.now()), writeFileSync(seenFile, JSON.stringify(seen)));
    // The keyboard game's score, per instance like the rest of this folder.
    const keyboardFile = join(opts.root, ".keyboard.json");
    let keyboard = readJson<KeyStats>(keyboardFile, emptyStats());
    const shelfFile = join(opts.root, ".shelf.json");
    let shelf = readJson<Shelf>(shelfFile, {});
    const saveShelf = (next: Shelf) => ((shelf = next), writeFileSync(shelfFile, JSON.stringify(shelf)));
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
        });
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
            saveSessions();
            broadcast();
        });
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
        const item: Shelved = { sessionId, script, label: label ?? gist ?? "session", ...(name ? { name } : {}), ...(given ? { named: given } : {}), gist, ...(owned?.length ? { prs: owned } : {}), at: Date.now() };
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

    const state = () => ({
        now: Date.now(),
        sessions: [...sessions.values()],
        projects: store.list().map(({ body: _body, ...p }) => p),
        plugins: runner.results,
        pluginNames: runner.names,
        pluginsRunning: runner.running,
        snoozes,
        seen,
        fixer: fixer.state(),
        ...(opts.journal ? { day: opts.journal.day(new Date()) } : {}),
        keyboard,
        // By the tab the project's folder belongs to now.
        shelf: Object.fromEntries(store.list().flatMap((p) => (p.id && shelf[basename(p.dir)] ? [[p.id, shelf[basename(p.dir)]]] : []))),
        ...(opts.lunch ? { lunch: opts.lunch } : {}),
        ...(opts.workday ? { workday: opts.workday } : {}),
    });
    const broadcast = () => {
        const frame = JSON.stringify(state());
        for (const s of sockets) s.send(frame);
    };
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
    });

    let watcher: FSWatcher | undefined;
    let pending: NodeJS.Timeout | undefined;
    const reload = () => {
        try {
            store.reload();
            broadcast();
        } catch (e) {
            console.error(`[wintosd] reload failed, keeping the last good state: ${e}`);
        }
    };
    try {
        // The daemon's own files (.sessions.json, .snoozes.json, .project-snoozes.json, .bindings.json) are not notes.
        watcher = watch(opts.root, { recursive: true }, (_e, file) => {
            if (file && !file.includes("/") && file.startsWith(".")) return;
            clearTimeout(pending);
            pending = setTimeout(reload, 100);
        });
        watcher.on("error", (e) => console.error(`[wintosd] watcher error, note edits will not show until restart: ${e}`));
    } catch (e) {
        console.error(`[wintosd] cannot watch ${opts.root}: ${e}`);
    }
    // The journal is edited outside WintOS too (your editor, the journal's own command): a change
    // there is pushed like a note edit, not only seen by the next request.
    let journalWatcher: FSWatcher | undefined;
    if (opts.journal)
        try {
            journalWatcher = watch(opts.journal.dir, { recursive: true }, () => {
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
            // The session a `wintos` call names (?session=), for the block routes.
            const sid = isSafe(url.searchParams.get("session")) ? url.searchParams.get("session")! : undefined;
            if (req.method === "OPTIONS") {
                res.setHeader("Access-Control-Allow-Headers", "content-type, x-wintos-token");
                res.setHeader("Access-Control-Allow-Methods", "GET, POST");
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
                const left = leavingFor(sessions, ev);
                // Shelved before the reduce drops them, while their status and PRs are still on hand.
                for (const l of left) shelveLive(l);
                sessions = reduceSession(sessions, ev, Date.now());
                // Running again: started or prompted. Closing its pane ends it (SessionEnd) on the way onto the shelf.
                // Off the shelf, it takes back the PRs it had there.
                const runs = p.hook_event_name === "SessionStart" || p.hook_event_name === "UserPromptSubmit";
                const shelved = Object.values(shelf).flat().find((i) => i.sessionId === p.session_id);
                if (runs && shelved) {
                    saveShelf(unshelve(shelf, p.session_id));
                    // Its name comes back with it, as whoever gave it.
                    const back = sessions.get(p.session_id);
                    if (shelved.named && back && !back.name) sessions = new Map(sessions).set(back.id, { ...back, name: shelved.named });
                    if (shelved.prs?.length) sessions = claimPrs(sessions, ev.blockId, shelved.prs) ?? sessions;
                }
                // A PR this session touched leaves any shelved session that had it.
                const touched = p.hook_event_name === "PostToolUse" ? (sessions.get(p.session_id)?.prs ?? []) : [];
                if (touched.length && releasePrs(shelf, touched) !== shelf) saveShelf(releasePrs(shelf, touched));
                saveSessions();
                const tp = (p as { transcript_path?: unknown }).transcript_path;
                if (p.hook_event_name === "Stop" && typeof tp === "string") nameByModel(p.session_id, tp, store.byTab(ev.tabId)?.title);
                recapper.record(ev.tabId, store.byTab(ev.tabId)?.title ?? "Untitled", p.session_id, typeof tp === "string" ? tp : undefined, p.hook_event_name === "UserPromptSubmit", Date.now());
                if (p.hook_event_name === "UserPromptSubmit") markSeen(p.session_id); // you read it to answer it
                const text =
                    p.hook_event_name === "UserPromptSubmit" ? injection(store.byTab(ev.tabId), store.mineDiff(ev.tabId, p.session_id)) : "";
                broadcast();
                return send(res, 200, text);
            }
            const plugin = /^\/plugins\/([^/]+)\/run$/.exec(url.pathname);
            if (req.method === "POST" && plugin) {
                return (await runner.run(decodeURIComponent(plugin[1]))) ? send(res, 200, "") : send(res, 404, "no such plugin");
            }
            if (req.method === "GET" && url.pathname === "/projects/texts") return json(res, store.texts());
            if (req.method === "GET" && url.pathname === "/day/recap") return json(res, await recapper.recap(Date.now()));
            if (req.method === "POST" && url.pathname === "/keyboard") {
                const b = (await body(req)) as { kind?: unknown; key?: unknown };
                if ((b?.kind !== "key" && b?.kind !== "click") || typeof b.key !== "string" || !b.key || b.key.length > 24) return send(res, 400, "need kind key|click and the key");
                keyboard = (b.kind === "key" ? recordKey : recordClick)(keyboard, b.key, Date.now());
                writeFileSync(keyboardFile, JSON.stringify(keyboard));
                broadcast();
                return send(res, 200, "");
            }
            if (url.pathname.startsWith("/day/") && !opts.journal) return send(res, 404, "no journal: set WINTOS_JOURNAL_DIR");
            if (req.method === "POST" && url.pathname === "/day/focus") {
                const b = (await body(req)) as { text?: unknown; baseMtime?: unknown };
                if (typeof b?.text !== "string" || b.text.length > 20_000) return send(res, 400, "need the focus text");
                const text = await formatMarkdown(b.text);
                const r = opts.journal!.saveFocus(new Date(), text, typeof b.baseMtime === "number" ? b.baseMtime : undefined);
                if (r === "conflict") return send(res, 409, "the day's file changed on disk");
                // All of today's focus ticked: the keyboard game's day-done bonus (once a day).
                if (/\[[xX]\]/.test(text) && !/^\s*[-*] \[[ ~]\]/m.test(text)) {
                    keyboard = recordDayDone(keyboard, Date.now());
                    writeFileSync(keyboardFile, JSON.stringify(keyboard));
                }
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
            if (req.method === "POST" && url.pathname === "/prs/snooze") {
                const b = (await body(req)) as { url?: unknown; until?: unknown; movedAt?: unknown };
                if (typeof b?.url !== "string" || !PR_URL.test(b.url)) return send(res, 400, "need a GitHub PR url");
                if (b.until === null) delete snoozes[b.url];
                else if (typeof b.until === "number" && typeof b.movedAt === "string") snoozes[b.url] = { until: b.until, movedAt: b.movedAt };
                else return send(res, 400, "need until (a time, or null to wake) and movedAt");
                const now = Date.now();
                snoozes = Object.fromEntries(Object.entries(snoozes).filter(([, s]) => s.until > now));
                writeFileSync(snoozeFile, JSON.stringify(snoozes));
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
            // A one-off rebuild of PR ownership (from the sessions' transcripts): url → session id, or null.
            if (req.method === "POST" && url.pathname === "/prs/owners") {
                const b = (await body(req)) as { owners?: unknown };
                const owners = b?.owners;
                const valid = owners && typeof owners === "object" && Object.entries(owners).every(([u, id]) => PR_URL.test(u) && (id === null || isSafe(id)));
                if (!valid) return send(res, 400, "need owners: { <PR url>: <session id> | null }");
                const r = reassignPrs(sessions, shelf, owners as Record<string, string | null>);
                sessions = r.sessions;
                saveSessions();
                saveShelf(r.shelf);
                broadcast();
                return send(res, 200, "");
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
            const unpark = /^\/sessions\/([^/]+)\/unpark$/.exec(url.pathname);
            if (req.method === "POST" && unpark) {
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
            // `wintos name`: the session names itself. ⌥⌘N: you rename it, or take its suggestion.
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
                saveSessions();
                broadcast();
                return send(res, 200, "");
            }
            const claimed = /^\/blocks\/([^/]+)\/pr$/.exec(url.pathname);
            if (req.method === "POST" && claimed) {
                const blockId = decodeURIComponent(claimed[1]);
                const b = (await body(req)) as { ref?: unknown };
                const link = typeof b?.ref === "string" ? prLink(b.ref) : undefined;
                if (!isSafe(blockId) || !link) return send(res, 400, "need a PR link or owner/repo#number");
                const next = claimPrs(sessions, blockId, [link], sid);
                if (!next) return send(res, 400, "no live session in this pane");
                sessions = next;
                if (releasePrs(shelf, [link]) !== shelf) saveShelf(releasePrs(shelf, [link]));
                saveSessions();
                broadcast();
                return send(res, 200, link);
            }
            const todo = /^\/blocks\/([^/]+)\/todo$/.exec(url.pathname);
            if (req.method === "POST" && todo) {
                const blockId = decodeURIComponent(todo[1]);
                const b = (await body(req)) as { items?: unknown; done?: unknown };
                const items = Array.isArray(b?.items) ? b.items.map((s) => (typeof s === "string" ? s.trim() : "")) : undefined;
                const okItems = items && items.length > 0 && items.length <= MAX_STEPS && items.every((s) => s && isSafe(s) && s.length <= MAX_TODO);
                if (!isSafe(blockId) || (!okItems && !isSafe(b?.done))) return send(res, 400, `need 1-${MAX_STEPS} one-line to-dos up to ${MAX_TODO} characters, or the one done`);
                const next = okItems ? setTodo(sessions, blockId, items!, sid) : tickTodo(sessions, blockId, b.done as string, sid);
                if (!next) return send(res, 400, okItems ? "no lane in this session; run wintos lane first" : "no such to-do in this step");
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
    return {
        http: server,
        close: () => {
            watcher?.close();
            journalWatcher?.close();
            clearInterval(warmRecap);
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

function readJson<T>(file: string, fallback: T): T {
    try {
        return JSON.parse(readFileSync(file, "utf8"));
    } catch {
        return fallback;
    }
}

// A PR as the session names it: its link, or owner/repo#number.
function prLink(ref: string): string | undefined {
    const url = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/.exec(ref.trim());
    const short = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(ref.trim());
    const m = url ?? short;
    return m ? `https://github.com/${m[1]}/pull/${m[2]}` : undefined;
}
