import { watch, type FSWatcher } from "fs";
import http from "http";
import type { AddressInfo } from "net";
import { WebSocketServer, type WebSocket } from "ws";
import { injection } from "../inject";
import { ProjectStore } from "../projects/store";
import { HookEvent, reduceSession, Session } from "../sessions/reduce";

export type WintosServer = { http: http.Server; close: () => void };

// The WintOS renderer in dev. A packaged build adds its own origin via WINTOS_UI_ORIGINS.
const DEFAULT_UI_ORIGINS = ["http://localhost:5173"];
const MAX_BODY = 1_000_000;
const MAX_TITLE = 120;
// Ids and titles end up as front matter lines; a line break would let a value forge keys.
const SAFE = /^[^\r\n\u0000-\u001f]+$/;

export async function startServer(opts: { root: string; port: number; host?: string; uiOrigins?: string[] }): Promise<WintosServer> {
    const store = new ProjectStore(opts.root);
    const uiOrigins = new Set(opts.uiOrigins ?? [...DEFAULT_UI_ORIGINS, ...(process.env.WINTOS_UI_ORIGINS?.split(",") ?? [])]);
    let sessions = new Map<string, Session>();
    const sockets = new Set<WebSocket>();
    let port = opts.port;

    const state = () => ({
        now: Date.now(),
        sessions: [...sessions.values()],
        projects: store.list().map(({ body: _body, ...p }) => p),
    });
    const broadcast = () => {
        const frame = JSON.stringify(state());
        for (const s of sockets) s.send(frame);
    };

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
        watcher = watch(opts.root, { recursive: true }, () => {
            clearTimeout(pending);
            pending = setTimeout(reload, 100);
        });
        watcher.on("error", (e) => console.error(`[wintosd] watcher error, note edits will not show until restart: ${e}`));
    } catch (e) {
        console.error(`[wintosd] cannot watch ${opts.root}: ${e}`);
    }

    // Only the hook (no Origin) and the WintOS UI may talk to us. Any web page in any browser
    // on this machine can reach 127.0.0.1, and the Host check stops DNS rebinding.
    const refusal = (req: http.IncomingMessage): string | null => {
        const host = req.headers.host ?? "";
        if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return "bad host";
        const origin = req.headers.origin;
        if (origin && !uiOrigins.has(origin)) return "origin not allowed";
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
                res.setHeader("Access-Control-Allow-Headers", "content-type");
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
                const text =
                    p.hook_event_name === "UserPromptSubmit" ? injection(store.byTab(ev.tabId), store.mineDiff(ev.tabId, p.session_id)) : "";
                broadcast();
                return send(res, 200, text);
            }
            const notes = /^\/projects\/([^/]+)\/notes$/.exec(url.pathname);
            if (req.method === "GET" && notes) {
                const n = store.notes(decodeURIComponent(notes[1]));
                return n ? json(res, n) : send(res, 404, "no project for this tab");
            }
            const mine = /^\/projects\/([^/]+)\/mine$/.exec(url.pathname);
            if (req.method === "POST" && mine) {
                const b = (await body(req)) as { text?: unknown };
                if (typeof b?.text !== "string") return send(res, 400, "need text");
                if (!store.saveMine(decodeURIComponent(mine[1]), b.text)) return send(res, 404, "no project for this tab");
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
    return {
        http: server,
        close: () => {
            watcher?.close();
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
