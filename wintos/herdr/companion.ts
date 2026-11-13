import { execFile } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { prNow as githubPrNow } from "../daemon/wakes/github";
import { expiresAt, isWakeEvent, MAX_PROMPT, reached, unreachable, type WakeEvent } from "../daemon/wakes/wakes";
import { createCalendarFeed, type CalendarView } from "./backend/calendar";
import { codexHistory, resumedCodex } from "./backend/codex";
import {
    matches,
    prUrls,
    readJson,
    resumeParts,
    transcriptHistory,
    waveHistory,
    type SessionHit,
} from "./backend/history";
import { createSystemSampler, type SystemView } from "./backend/system";
export type { SessionHit } from "./backend/history";

export type Exec = (command: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
export type CompanionOptions = {
    root?: string;
    codexHome?: string | false;
    wintosRoot?: string;
    exec?: Exec;
    prNow?: typeof githubPrNow;
    now?: () => number;
    pollMs?: number;
    calendar?: () => Promise<CalendarView>;
    system?: () => Promise<SystemView>;
};
type Indexed = SessionHit & { transcriptPath?: string };
type Wake = {
    id: string;
    terminal: string;
    sessionId: string;
    event: WakeEvent | "run";
    target: string;
    prompt: string;
    at: number;
    expires: number;
    status: "pending" | "delivered" | "cancelled" | "expired";
    due?: number;
    deliveredAt?: number;
    outcome?: string;
    error?: string;
};
type State = {
    sessions: Record<string, Indexed>;
    terminals: Record<string, string>;
    wakes: Record<string, Wake>;
    opening: Record<string, number>;
};
type Terminal = {
    cwd?: string;
    labels?: Record<string, string>;
    foreground?: { argv?: string[]; pid?: number };
    state: string;
    status?: { app?: string; state?: string };
};
const runPattern = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/actions\/runs\/(\d+)\/?$/;
const prPattern = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+\/?$/;
const failure = (status: number, message: string): never => {
    throw Object.assign(new Error(message), { status });
};
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const defaultExec: Exec = (command, args) =>
    new Promise((resolve) =>
        execFile(command, args, { timeout: 30_000, maxBuffer: 8 << 20 }, (err, stdout, stderr) =>
            resolve({ code: err ? Number(err.code) || 1 : 0, stdout, stderr: stderr || err?.message || "" })
        )
    );

export async function createCompanion(options: CompanionOptions = {}) {
    const root = resolve(options.root ?? join(homedir(), ".local/share/wintos-herdr-companion"));
    const wintosRoot = resolve(
        (options.wintosRoot ?? process.env.WINTOS_ROOT ?? join(homedir(), ".local/share/wintos/projects")).replace(
            /^~/,
            homedir()
        )
    );
    if (root === wintosRoot || root.startsWith(wintosRoot + "/"))
        throw new Error("Companion state must be outside WintOS history");
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const file = join(root, "state.json");
    const state = readJson<State>(file, { sessions: {}, terminals: {}, wakes: {}, opening: {} });
    const now = options.now ?? Date.now;
    const exec = options.exec ?? defaultExec;
    const calendar = options.calendar ?? createCalendarFeed({ now }).read;
    const system = options.system ?? createSystemSampler({ now }).read;
    const transcriptCache = new Map<string, number>();
    const codexRoot =
        options.codexHome === false
            ? undefined
            : (options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex"));
    const codexCache = new Map<string, number>();
    let team: string[] | undefined;
    let unboundCodex: { terminal: string; pid?: number }[] = [];
    let closed = false,
        polling: Promise<void> | undefined,
        lastError: string | undefined;
    const save = () => {
        writeFileSync(file + ".tmp", JSON.stringify(state), { mode: 0o600 });
        renameSync(file + ".tmp", file);
    };
    const checked = async (cmd: string, args: string[]) => {
        const result = await exec(cmd, args);
        if (result.code) throw new Error(`${cmd}: ${result.stderr || result.stdout || `exit ${result.code}`}`);
        return result.stdout;
    };
    const terminal = async (id: string): Promise<Terminal | undefined> => {
        const result = await exec("hc", ["get", id, "--json"]);
        if (result.code === 3) return undefined;
        if (result.code) throw new Error(`hc get: ${result.stderr}`);
        return JSON.parse(result.stdout);
    };
    const sameAgent = (s: Pick<SessionHit, "id" | "provider" | "terminalPid">, t: Terminal | undefined) => {
        if (t?.state !== "live") return false;
        const pidMatches =
            Number.isSafeInteger(s.terminalPid) && s.terminalPid! > 0 && t.foreground?.pid === s.terminalPid;
        if (s.terminalPid && !pidMatches) return false;
        if (s.provider === "codex") {
            const id = resumedCodex(t);
            return t.status?.app === "codex" && (!id || id === s.id) && (id === s.id || pidMatches);
        }
        if (!["claude", "claude-code"].includes(t.status?.app ?? "")) return false;
        const argv = t.foreground?.argv ?? [];
        const resumeAt = argv.findIndex((arg) => arg === "--resume" || arg === "-r" || arg.startsWith("--resume="));
        const resumed =
            resumeAt < 0
                ? undefined
                : argv[resumeAt].startsWith("--resume=")
                  ? argv[resumeAt].slice(9)
                  : argv[resumeAt + 1];
        if (resumed && resumed !== s.id) return false;
        const exactResume = basename(argv[0] ?? "") === "claude" && resumed === s.id;
        return exactResume || pidMatches;
    };
    const current = (s: SessionHit) => s.terminal && state.terminals[s.terminal] === s.id;

    function index(query = ""): SessionHit[] {
        const found = new Map<string, SessionHit>();
        for (const hit of waveHistory(wintosRoot)) found.set(hit.id, { ...found.get(hit.id), ...hit });
        for (const hit of Object.values(state.sessions)) {
            const old = found.get(hit.id);
            if (old?.source === "wintos" && old.live) continue;
            found.set(hit.id, {
                ...old,
                ...hit,
                prs: [...new Set([...(old?.prs ?? []), ...hit.prs])],
                live: !!current(hit) && hit.live !== false,
            });
        }
        return [...found.values()].filter((s) => matches(s, query)).sort((a, b) => b.lastAt - a.lastAt);
    }

    async function refreshCodex(query = "", withHistory = true) {
        if (!codexRoot && withHistory) return;
        if (codexRoot && withHistory && now() - (codexCache.get(query) ?? -Infinity) >= 60_000) {
            for (const { indexedTitle, ...hit } of await codexHistory(codexRoot, query)) {
                const old = state.sessions[hit.id];
                const knownName = old?.name && old.name !== hit.id ? old.name : undefined;
                state.sessions[hit.id] = {
                    ...hit,
                    ...old,
                    name: indexedTitle ?? knownName ?? hit.name,
                    prs: [...new Set([...hit.prs, ...(old?.prs ?? [])])],
                };
            }
            codexCache.set(query, now());
        }
        const result = await exec("hc", ["ls", "--json"]);
        if (result.code) throw Error("Could not inspect live Herdr sessions");
        const entries = JSON.parse(result.stdout).terminals ?? [];
        const unbound: typeof unboundCodex = [];
        await Promise.all(
            entries
                .filter((t) => t.state === "live" && t.agent === "codex" && !t.address.includes("/"))
                .map(async (t) => {
                    const wire = await terminal(t.address);
                    if (!wire || wire.state !== "live") return;
                    const id = resumedCodex(wire);
                    if (!id || !wire.labels?.["herdr.tab"]) {
                        const bound = state.sessions[state.terminals[t.address]];
                        if (!bound || bound.provider !== "codex" || !sameAgent(bound, wire))
                            unbound.push({ terminal: t.address, pid: wire.foreground?.pid });
                        return;
                    }
                    const old = state.sessions[id];
                    state.sessions[id] = {
                        ...old,
                        id,
                        name: old?.name ?? wire.labels.where ?? id,
                        prs: old?.prs ?? [],
                        provider: "codex",
                        configDir: old?.configDir ?? codexRoot,
                        source: "herdr",
                        lastAt: old?.lastAt ?? now(),
                        cwd: wire.cwd,
                        terminal: t.address,
                        terminalPid: wire.foreground?.pid,
                        live: true,
                    };
                    state.terminals[t.address] = id;
                    delete state.opening[id];
                })
        );
        unboundCodex = unbound;
        save();
    }

    async function search(query: string) {
        await refreshCodex(query);
        if (now() - (transcriptCache.get(query) ?? -Infinity) >= 60_000) {
            const dirs = [
                ...(options.root ? [] : [join(homedir(), ".claude")]),
                ...Object.values(state.sessions).flatMap((s) => (s.configDir ? [s.configDir] : [])),
            ];
            for (const hit of await transcriptHistory(dirs, query)) {
                if (!state.sessions[hit.id]) state.sessions[hit.id] = hit;
                else state.sessions[hit.id].prs = [...new Set([...state.sessions[hit.id].prs, ...hit.prs])];
            }
            transcriptCache.set(query, now());
            save();
        }
        return index(query);
    }

    function register(body: Record<string, any>) {
        const p = body.payload;
        if (
            !text(body.terminal) ||
            (!text(body.configDir) && body.configOverride !== null) ||
            !p ||
            typeof p !== "object" ||
            Array.isArray(p) ||
            !text(p.session_id) ||
            !text(p.hook_event_name)
        )
            failure(400, "terminal, configDir and hook payload with session_id and hook_event_name are required");
        if (p.agent_id || p.kind === "bg") return { ignored: true };
        const old = state.sessions[p.session_id];
        const prs = prUrls(
            [
                typeof p.prompt === "string" ? p.prompt : "",
                p.tool_name === "Bash" ? (p.tool_input?.command ?? "") : "",
                p.tool_name === "Bash" ? JSON.stringify(p.tool_response ?? "") : "",
            ].join("\n")
        );
        const ended = p.hook_event_name === "SessionEnd";
        state.sessions[p.session_id] = {
            ...old,
            id: p.session_id,
            name: text(p.title)
                ? p.title
                : text(p.name)
                  ? p.name
                  : old?.name && old.name !== p.session_id
                    ? old.name
                    : (typeof p.prompt === "string" ? p.prompt.split("\n")[0].slice(0, 200) : "") || p.session_id,
            prs: [...new Set([...(old?.prs ?? []), ...prs])],
            source: "herdr",
            provider: body.provider === "codex" ? "codex" : "claude",
            terminalPid: Number.isSafeInteger(body.terminalPid) && body.terminalPid > 0 ? body.terminalPid : undefined,
            lastAt: now(),
            terminal: body.terminal,
            configDir: text(body.configDir) ? body.configDir : join(homedir(), ".claude"),
            configOverride:
                body.configOverride === null ? null : text(body.configOverride) ? body.configOverride : body.configDir,
            cwd: text(body.launchDir) ? body.launchDir : (old?.cwd ?? (text(p.cwd) ? p.cwd : undefined)),
            transcriptPath: text(p.transcript_path) ? p.transcript_path : old?.transcriptPath,
            live: !ended,
        };
        if (!ended) {
            state.terminals[body.terminal] = p.session_id;
            delete state.opening[p.session_id];
        } else if (state.terminals[body.terminal] === p.session_id) delete state.terminals[body.terminal];
        save();
        return { id: p.session_id };
    }

    async function open(id: string, stillCurrent = () => true) {
        if (state.sessions[id]?.provider === "codex") await refreshCodex("", false);
        if (!stillCurrent()) return { id, skipped: true };
        const hit = index().find((s) => s.id === id);
        if (!hit) failure(404, "Session not found");
        if (hit.source === "wintos" && hit.live) failure(409, "Session is live in WintOS; focus it in Wave");
        if (current(hit)) {
            const t = await terminal(hit.terminal!);
            if (!stillCurrent()) return { id, skipped: true };
            if (current(hit) && sameAgent(hit, t)) {
                await checked("herdr-app", ["do", "agent.focus", "--terminal", hit.terminal!]);
                return { id, focused: true };
            }
            if (t?.state === "live") failure(409, "Mapped terminal is live but is not the confirmed conversation");
        }
        if (hit.provider === "codex" && unboundCodex.length)
            failure(
                409,
                `Unbound live Codex terminal(s): ${unboundCodex.map((t) => t.terminal).join(", ")}. Register the active thread with wintos wake in that terminal, or close it before resuming history.`
            );
        return resumeInNewTab(hit, stillCurrent);
    }

    async function resumeInNewTab(hit: SessionHit, stillCurrent: () => boolean) {
        const id = hit.id;
        if (state.opening[id] != null && now() - state.opening[id] < 60_000) return { id, opening: true };
        const parts = resumeParts(hit.resume, hit.id);
        if (hit.resume && !parts) failure(409, "Unrecognized resume script; refusing to execute it");
        const cwd = parts?.cwd ?? hit.cwd;
        const configDir = parts
            ? parts.configDir
            : hit.configOverride !== undefined
              ? (hit.configOverride ?? undefined)
              : hit.provider !== "codex" && hit.configDir === join(homedir(), ".claude")
                ? undefined
                : hit.configDir;
        if (!cwd) failure(409, "Session has no known working directory");
        const openingAt = now();
        state.opening[id] = openingAt;
        save();
        let opened = false;
        try {
            if (hit.source === "transcript") {
                const modified = hit.transcriptPath ? (await stat(hit.transcriptPath)).mtimeMs : hit.lastAt;
                if (now() - Math.max(hit.lastAt, modified) < 10 * 60_000)
                    failure(409, "Transcript is recent; cannot confirm the session is closed");
            }
            const processes = await checked("ps", ["-axo", "args="]);
            if (!stillCurrent()) return { id, skipped: true };
            if (processes.split("\n").some((line) => /\b(claude|codex)\b/.test(line) && line.includes(id)))
                failure(409, "Claude process for this session may still be running");
            const argv =
                hit.provider === "codex"
                    ? [...(configDir ? ["env", `CODEX_HOME=${configDir}`] : []), "codex", "resume", id]
                    : [
                          ...(configDir
                              ? ["env", `CLAUDE_CONFIG_DIR=${configDir}`]
                              : ["env", "-u", "CLAUDE_CONFIG_DIR"]),
                          "claude",
                          "--resume",
                          id,
                      ];
            await checked("herdr-app", ["do", "tab.new", JSON.stringify({ name: hit.name, folder: cwd, argv })]);
            opened = true;
            return { id, opening: true };
        } finally {
            if (!opened && state.opening[id] === openingAt) {
                delete state.opening[id];
                save();
            }
        }
    }

    function registerWake(body: Record<string, any>) {
        if (!text(body.terminal)) failure(400, "terminal is required");
        const sessionId = state.terminals[body.terminal];
        if (!sessionId || (body.sessionId && body.sessionId !== sessionId))
            failure(409, "No matching latest session for terminal");
        if (body.event === "cancel") {
            for (const wake of Object.values(state.wakes))
                if (wake.sessionId === sessionId && wake.status === "pending") wake.status = "cancelled";
            save();
            return { sessionId, cancelled: true };
        }
        if (
            (!isWakeEvent(body.event) && body.event !== "run") ||
            !text(body.target) ||
            !text(body.prompt) ||
            body.prompt.length > MAX_PROMPT
        )
            failure(400, "Valid event, target and prompt (up to 1000 characters) are required");
        const shorthand = /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(body.target);
        if (shorthand && body.event !== "run")
            body.target = `https://github.com/${shorthand[1]}/${shorthand[2]}/pull/${shorthand[3]}`;
        if (!(body.event === "run" ? runPattern : prPattern).test(body.target))
            failure(400, "Target must be an exact GitHub PR or Actions run URL for its event");
        const target = body.target.replace(/\/$/, "");
        const id = `${sessionId} ${body.event} ${target}`;
        const wake: Wake = {
            id,
            terminal: body.terminal,
            sessionId,
            event: body.event,
            target,
            prompt: body.prompt,
            at: now(),
            expires: expiresAt(now()),
            status: "pending",
        };
        state.wakes[id] = wake;
        save();
        return wake;
    }

    async function foregroundCodexCaller(callerPid: unknown, foregroundPid: number | undefined) {
        if (!Number.isSafeInteger(callerPid) || Number(callerPid) <= 1 || !foregroundPid) return false;
        let pid = Number(callerPid);
        const seen = new Set<number>();
        while (pid > 1 && !seen.has(pid)) {
            seen.add(pid);
            const result = await exec("ps", ["-p", String(pid), "-o", "ppid=", "-o", "comm="]);
            const process = /^\s*(\d+)\s+(.+?)\s*$/.exec(result.stdout);
            if (result.code || !process) return false;
            if (/^codex(?:-[\w.-]+)?$/.test(basename(process[2]))) return pid === foregroundPid;
            pid = Number(process[1]);
        }
        return false;
    }

    async function codexWakeBinding(body: Record<string, any>) {
        const wire = await terminal(body.terminal);
        if (wire?.state !== "live" || wire.status?.app !== "codex") return;
        const resumed = resumedCodex(wire);
        if (resumed && resumed !== body.codexId) failure(409, "Codex thread does not match the terminal");
        if (!resumed && !(await foregroundCodexCaller(body.callerPid, wire.foreground?.pid)))
            failure(
                409,
                "Fresh Codex thread ownership could not be verified. Exit and resume this conversation in the same Herdr terminal, then retry."
            );
        return { id: body.codexId, provider: "codex" as const, terminalPid: wire.foreground?.pid, cwd: wire.cwd };
    }

    async function nativeWake(body: Record<string, any>) {
        if (!text(body.terminal) && text(body.codexId)) {
            await refreshCodex("", false);
            const session = state.sessions[body.codexId];
            const wire = session && current(session) ? await terminal(session.terminal!) : undefined;
            if (!session || !sameAgent(session, wire) || resumedCodex(wire ?? {}) !== body.codexId)
                failure(
                    409,
                    "Cannot identify this Codex thread's terminal. An exact resumed-thread identity is required without HC_TERMINAL_ID and foreground-process evidence."
                );
            body.terminal = session.terminal;
        }
        const previousId = state.terminals[body.terminal];
        const binding = text(body.codexId) && text(body.terminal) ? await codexWakeBinding(body) : undefined;
        if (text(body.terminal)) {
            const wire = await terminal(body.terminal);
            if (state.terminals[body.terminal] !== previousId)
                failure(409, "No matching latest session for terminal; its foreground changed");
            if (binding) {
                if (!sameAgent(binding, wire)) failure(409, "Codex thread does not match the terminal");
                register({
                    terminal: body.terminal,
                    terminalPid: binding.terminalPid,
                    provider: "codex",
                    configDir: body.codexHome ?? codexRoot ?? join(homedir(), ".codex"),
                    payload: {
                        session_id: body.codexId,
                        hook_event_name: "UserPromptSubmit",
                        cwd: binding.cwd ?? process.cwd(),
                    },
                });
                body.sessionId = body.codexId;
            } else {
                const session = state.sessions[previousId];
                if (!session || !current(session) || !sameAgent(session, wire))
                    failure(409, "No matching latest session for terminal; its foreground changed");
            }
        }
        return registerWake(body);
    }

    async function reviewersFor(event: WakeEvent) {
        let me = process.env.WINT_GITHUB_USERNAME ?? "";
        if (!options.prNow && !me) me = (await checked("gh", ["api", "user", "--jq", ".login"])).trim();
        if (event === "rereview" && team === undefined) {
            const spec = /^([^/\s]+)\/([^/\s]+)$/.exec(process.env.WINTOS_TEAM ?? "");
            if (spec) {
                try {
                    const [, org, slug] = spec;
                    team = [
                        (await checked("gh", ["api", `orgs/${org}/teams/${slug}`, "--jq", ".name"])).trim(),
                        ...(
                            await checked("gh", [
                                "api",
                                "--paginate",
                                `orgs/${org}/teams/${slug}/members`,
                                "--jq",
                                ".[].login",
                            ])
                        )
                            .split("\n")
                            .filter(Boolean),
                    ];
                } catch {}
            }
        }
        return { me, ...(event === "rereview" && team ? { team } : {}) };
    }

    async function checkWake(wake: Wake) {
        if (wake.event !== "run" && wake.due != null) return;
        if (now() > wake.expires) {
            wake.status = "expired";
            return;
        }
        if (wake.event === "run") {
            delete wake.due;
            delete wake.outcome;
            const m = runPattern.exec(wake.target)!;
            const result = JSON.parse(await checked("gh", ["api", `repos/${m[1]}/${m[2]}/actions/runs/${m[3]}`]));
            if (result.status !== "completed") return;
            if (!text(result.conclusion)) throw new Error("Completed Actions run has no conclusion");
            wake.outcome = result.conclusion;
            wake.due = now();
            return;
        }
        const pr = await (options.prNow ?? githubPrNow)(wake.target, await reviewersFor(wake.event), [wake.event]);
        if (!pr) throw new Error("GitHub PR lookup unavailable; will retry");
        if (reached(wake.event, pr, wake.at)) wake.due = now();
        else if (unreachable(wake.event, pr)) wake.status = "cancelled";
    }

    const currentWake = (wake: Wake) => state.wakes[wake.id] === wake && wake.status === "pending";

    async function deliver(wake: Wake) {
        if (!currentWake(wake)) return;
        const session = state.sessions[wake.sessionId];
        const stillCurrent = () => currentWake(wake) && state.sessions[wake.sessionId] === session;
        if (!session || !current(session)) {
            await open(wake.sessionId, stillCurrent);
            return;
        }
        const address = session.terminal!;
        let t = await terminal(address);
        if (!currentWake(wake)) return;
        if (!t || t.state === "finished") {
            await open(wake.sessionId, stillCurrent);
            return;
        }
        if (!sameAgent(session, t) || !["idle", "done"].includes(t.status?.state ?? "")) return;
        const wasDone = t.status!.state === "done";
        if (wasDone) t = await terminal(address);
        if (
            !current(session) ||
            state.sessions[wake.sessionId] !== session ||
            !sameAgent(session, t) ||
            !currentWake(wake)
        )
            return;
        if (wasDone && !["idle", "done"].includes(t!.status!.state ?? "")) return;
        const failed = wake.event === "run" && wake.outcome !== "success";
        const prompt = failed
            ? `[Herdr wake: Actions run ${wake.outcome}] ${wake.target} ended without success. Inspect the run and report the failure; the success follow-up was not executed.`
            : `[Herdr wake: ${wake.event}${wake.event === "run" ? " success" : ""}] ${wake.target} ${wake.prompt}`;
        const args = ["send", address, prompt, ...(t!.status!.state === "idle" ? ["--if", "idle"] : [])];
        await checked("hc", args);
        wake.status = "delivered";
        wake.deliveredAt = now();
        delete wake.error;
    }

    async function pollWakes() {
        for (const wake of Object.values(state.wakes)) {
            if (closed || !currentWake(wake)) continue;
            try {
                delete wake.error;
                if (state.sessions[wake.sessionId]?.provider === "codex") await refreshCodex("", false);
                await checkWake(wake);
                save();
                if (currentWake(wake) && wake.due != null) await deliver(wake);
            } catch (e) {
                wake.error = messageOf(e);
            }
            save();
        }
    }
    const poll = () => {
        if (closed) return Promise.resolve();
        if (!polling)
            polling = pollWakes()
                .catch((e) => {
                    lastError = messageOf(e);
                    console.error("[herdr-companion]", lastError);
                })
                .finally(() => {
                    polling = undefined;
                });
        return polling;
    };
    const server = createServer((req, res) => {
        const json = (status: number, value: unknown) => {
            res.writeHead(status, { "Content-Type": "application/json" });
            res.end(JSON.stringify(value));
        };
        void (async () => {
            const port = req.socket.localPort;
            if (!port || ![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host ?? ""))
                failure(403, "Loopback Host and listening port are required");
            if (req.headers.origin != null) failure(403, "Browser Origin is not allowed");
            const url = new URL(req.url ?? "/", "http://127.0.0.1");
            if (req.method === "GET") {
                if (url.pathname === "/meetings") return json(200, await calendar());
                if (url.pathname === "/system") return json(200, await system());
                if (url.pathname === "/health")
                    return json(200, { ok: !lastError, ...(lastError ? { error: lastError } : {}) });
                if (url.pathname === "/search")
                    return json(200, await search((url.searchParams.get("q") ?? "").trim()));
                if (url.pathname === "/wakes") return json(200, Object.values(state.wakes));
            }
            if (req.method !== "POST") return json(404, { error: "Not found" });
            const body = await readBody(req);
            if (url.pathname === "/events") return json(200, register(body));
            if (url.pathname === "/wake") return json(200, await nativeWake(body));
            if (url.pathname === "/open") {
                if (!text(body.id)) failure(400, "id is required");
                return json(200, await open(body.id));
            }
            json(404, { error: "Not found" });
        })().catch((e) => json(e.status ?? 500, { error: messageOf(e) }));
    });
    const interval =
        options.pollMs === 0
            ? undefined
            : setInterval(() => {
                  void poll();
              }, options.pollMs ?? 60_000);
    interval?.unref();
    return {
        server,
        poll,
        listen: (port = 7732) =>
            new Promise<number>((resolve, reject) => {
                server.once("error", reject);
                server.listen(port, "127.0.0.1", () => {
                    server.off("error", reject);
                    resolve((server.address() as { port: number }).port);
                });
            }),
        close: async () => {
            closed = true;
            clearInterval(interval);
            await polling;
            if (server.listening)
                await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
        },
    };
}

async function readBody(req: IncomingMessage): Promise<Record<string, any>> {
    if (req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json")
        failure(415, "Content-Type must be application/json");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > 1024 * 1024) failure(413, "Body exceeds 1 MiB");
        chunks.push(chunk);
    }
    let body: unknown;
    try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
        failure(400, "Invalid JSON");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) failure(400, "JSON object required");
    return body as Record<string, any>;
}
