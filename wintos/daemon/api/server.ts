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
import { dayRecapper } from "../recap/day";
import { emptyStats, recordClick, recordDayDone, recordKey, type KeyStats } from "../keyboard/keyboard";
import { resumedSession, shelve, unshelve, type Shelf } from "../shelf/shelf";
import { finishSession, HookEvent, parkSession, reduceSession, restoreSessions, Session } from "../sessions/reduce";

export type WintosServer = { http: http.Server; close: () => void };

// The WintOS renderer in dev. A packaged build adds its own origin via WINTOS_UI_ORIGINS.
const DEFAULT_UI_ORIGINS = ["http://localhost:5173"];
const MAX_BODY = 1_000_000;
const MAX_TITLE = 120;
// Ids and titles end up as front matter lines; a line break would let a value forge keys.
const SAFE = /^[^\r\n\u0000-\u001f]+$/;

// token: a per-launch secret Electron hands to both wintosd and the UI. Any request that comes
// from a web origin must carry it, because the UI's origin alone proves nothing: every Vite
// dev server is http://localhost:5173 too.
// journal: a daily journal for the Today page; lunch: "HH:MM-HH:MM", never counted as free time.
export async function startServer(opts: { root: string; port: number; host?: string; uiOrigins?: string[]; plugins?: Plugin[]; token?: string; journal?: Journal; lunch?: string; workday?: string; recapCmd?: string; recapExtra?: string }): Promise<WintosServer> {
    const store = new ProjectStore(opts.root);
    const recapper = dayRecapper(opts.root, opts.recapCmd, opts.recapExtra);
    // Ready before you open the Today page: the summarizer takes a minute. Cached, so this is
    // one run a day.
    const warmRecap = setInterval(() => void recapper.recap(Date.now()).catch(() => {}), 30 * 60_000);
    warmRecap.unref();
    const uiOrigins = new Set(opts.uiOrigins ?? [...DEFAULT_UI_ORIGINS, ...(process.env.WINTOS_UI_ORIGINS?.split(",") ?? [])]);
    // Saved on every change and restored at start, so a restart doesn't forget who waits on you.
    const sessionFile = join(opts.root, ".sessions.json");
    let sessions = restoreSessions(readJson<Session[]>(sessionFile, []));
    const saveSessions = () => writeFileSync(sessionFile, JSON.stringify([...sessions.values()]));
    // When the developer last looked at each project: a reply after that is unread.
    const seenFile = join(opts.root, ".seen.json");
    const seen = readJson<Record<string, number>>(seenFile, {});
    const markSeen = (tabId: string) => ((seen[tabId] = Date.now()), writeFileSync(seenFile, JSON.stringify(seen)));
    // The keyboard game's score, per instance like the rest of this folder.
    const keyboardFile = join(opts.root, ".keyboard.json");
    let keyboard = readJson<KeyStats>(keyboardFile, emptyStats());
    const shelfFile = join(opts.root, ".shelf.json");
    let shelf = readJson<Shelf>(shelfFile, {});
    const saveShelf = (next: Shelf) => ((shelf = next), writeFileSync(shelfFile, JSON.stringify(shelf)));
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
        projectSnoozes,
        seen,
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

    // Kept next to the projects: a file there is not a project (those are folders).
    const snoozeFile = join(opts.root, ".snoozes.json");
    let snoozes = readJson<Snoozes>(snoozeFile, {});
    // Projects you think are done: hidden until they need you or you open them (tab id → since).
    const projectSnoozeFile = join(opts.root, ".project-snoozes.json");
    let projectSnoozes = readJson<Record<string, number>>(projectSnoozeFile, {});
    const runner = new PluginRunner(opts.plugins ?? [], () => broadcast());

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
                sessions = reduceSession(sessions, ev, Date.now());
                saveSessions();
                // Running again: started or prompted. Closing its pane ends it (SessionEnd) on the way onto the shelf.
                const runs = p.hook_event_name === "SessionStart" || p.hook_event_name === "UserPromptSubmit";
                if (runs && Object.values(shelf).some((l) => l.some((i) => i.sessionId === p.session_id))) saveShelf(unshelve(shelf, p.session_id));
                const tp = (p as { transcript_path?: unknown }).transcript_path;
                recapper.record(ev.tabId, store.byTab(ev.tabId)?.title ?? "Untitled", p.session_id, typeof tp === "string" ? tp : undefined, p.hook_event_name === "UserPromptSubmit", Date.now());
                if (p.hook_event_name === "UserPromptSubmit") markSeen(ev.tabId); // you read it to answer it
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
                const r = opts.journal!.saveFocus(new Date(), b.text, typeof b.baseMtime === "number" ? b.baseMtime : undefined);
                if (r === "conflict") return send(res, 409, "the day's file changed on disk");
                // All of today's focus ticked: the keyboard game's day-done bonus (once a day).
                if (/\[[xX]\]/.test(b.text) && !/^\s*[-*] \[[ ~]\]/m.test(b.text)) {
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
            const toShelf = /^\/projects\/([^/]+)\/shelf$/.exec(url.pathname);
            if (req.method === "POST" && toShelf) {
                const b = (await body(req)) as { script?: unknown; label?: unknown };
                const sessionId = typeof b?.script === "string" ? resumedSession(b.script) : undefined;
                if (!sessionId) return send(res, 400, "need the pane's resume command");
                const label = typeof b.label === "string" && isSafe(b.label) ? b.label.slice(0, MAX_TITLE) : "session";
                const p = store.byTab(decodeURIComponent(toShelf[1]));
                if (!p) return send(res, 404, "no project for this tab");
                saveShelf(shelve(shelf, basename(p.dir), { sessionId, script: b.script as string, label, gist: recapper.gistOf(sessionId), at: Date.now() }, 14));
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
                const r = store.saveMine(decodeURIComponent(mine[1]), b.text, typeof b.baseMtime === "number" ? b.baseMtime : undefined);
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
            const snoozeTab = /^\/projects\/([^/]+)\/snooze$/.exec(url.pathname);
            if (req.method === "POST" && snoozeTab) {
                const b = (await body(req)) as { on?: unknown };
                if (typeof b?.on !== "boolean") return send(res, 400, "need on: true or false");
                const tabId = decodeURIComponent(snoozeTab[1]);
                if (b.on) projectSnoozes = { ...projectSnoozes, [tabId]: Date.now() };
                else projectSnoozes = Object.fromEntries(Object.entries(projectSnoozes).filter(([id]) => id !== tabId));
                writeFileSync(projectSnoozeFile, JSON.stringify(projectSnoozes));
                broadcast();
                return send(res, 200, "");
            }
            const seenTab = /^\/projects\/([^/]+)\/seen$/.exec(url.pathname);
            if (req.method === "POST" && seenTab) {
                const tabId = decodeURIComponent(seenTab[1]);
                if (!isSafe(tabId)) return send(res, 400, "bad tab id");
                markSeen(tabId);
                broadcast();
                return send(res, 200, "");
            }
            const done = /^\/blocks\/([^/]+)\/done$/.exec(url.pathname);
            if (req.method === "POST" && done) {
                const blockId = decodeURIComponent(done[1]);
                if (!isSafe(blockId)) return send(res, 400, "bad block id");
                sessions = finishSession(sessions, blockId, Date.now());
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
                sessions = parkSession(sessions, blockId, reason, Date.now());
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
