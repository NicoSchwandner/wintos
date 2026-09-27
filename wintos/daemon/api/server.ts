import { watch, type FSWatcher } from "fs";
import http from "http";
import { injection } from "../inject";
import { ProjectStore } from "../projects/store";
import { HookEvent, reduceSession, Session } from "../sessions/reduce";

export type WintosServer = { http: http.Server; close: () => void };

const HEARTBEAT_MS = 15_000;
const MAX_BODY = 1_000_000;

export async function startServer(opts: { root: string; port: number; host?: string }): Promise<WintosServer> {
    const store = new ProjectStore(opts.root);
    let sessions = new Map<string, Session>();
    const clients = new Set<http.ServerResponse>();

    const state = () => ({
        now: Date.now(),
        sessions: [...sessions.values()],
        projects: store.list().map(({ body: _body, ...p }) => p),
    });
    const broadcast = () => {
        const frame = `event: state\ndata: ${JSON.stringify(state())}\n\n`;
        for (const c of clients) c.write(frame);
    };

    let watcher: FSWatcher | undefined;
    let pending: NodeJS.Timeout | undefined;
    try {
        watcher = watch(opts.root, { recursive: true }, () => {
            clearTimeout(pending);
            pending = setTimeout(() => (store.reload(), broadcast()), 100);
        });
    } catch (e) {
        console.error(`[wintosd] cannot watch ${opts.root}: ${e}`);
    }

    const server = http.createServer(async (req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        try {
            const url = new URL(req.url ?? "/", "http://x");
            if (req.method === "GET" && url.pathname === "/state") return json(res, state());
            if (req.method === "GET" && url.pathname === "/stream") {
                res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
                res.write(`event: state\ndata: ${JSON.stringify(state())}\n\n`);
                clients.add(res);
                const beat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
                req.on("close", () => (clearInterval(beat), clients.delete(res)));
                return;
            }
            if (req.method === "POST" && url.pathname === "/events") {
                const ev = (await body(req)) as HookEvent;
                if (!ev?.tabId || !ev.blockId || !ev.payload?.session_id || !ev.payload.hook_event_name)
                    return fail(res, 400, "need tabId, blockId, payload.session_id, payload.hook_event_name");
                sessions = reduceSession(sessions, ev, Date.now());
                const text =
                    ev.payload.hook_event_name === "UserPromptSubmit"
                        ? injection(store.byTab(ev.tabId), store.mineDiff(ev.tabId))
                        : "";
                broadcast();
                return send(res, 200, text);
            }
            const title = /^\/projects\/([^/]+)\/title$/.exec(url.pathname);
            if (req.method === "POST" && title) {
                const b = (await body(req)) as { title?: string; manual?: boolean };
                if (!b?.title?.trim()) return fail(res, 400, "need title");
                const p = store.setTitle(decodeURIComponent(title[1]), b.title.trim(), { manual: !!b.manual });
                broadcast();
                return json(res, p);
            }
            if (req.method === "OPTIONS") {
                res.setHeader("Access-Control-Allow-Headers", "content-type");
                return send(res, 204, "");
            }
            fail(res, 404, "not found");
        } catch (e) {
            fail(res, e instanceof SyntaxError ? 400 : 500, String(e));
        }
    });

    await new Promise<void>((resolve) => server.listen(opts.port, opts.host ?? "127.0.0.1", resolve));
    return {
        http: server,
        close: () => {
            watcher?.close();
            clearTimeout(pending);
            for (const c of clients) c.end();
            server.close();
        },
    };
}

function body(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (chunk) => {
            data += chunk;
            if (data.length > MAX_BODY) req.destroy();
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
const fail = (res: http.ServerResponse, code: number, msg: string) => send(res, code, msg);
