#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { createCompanion } from "./companion";

export async function runCli(
    args: string[],
    env: NodeJS.ProcessEnv = process.env,
    output: (line: string) => void = console.log
) {
    const [command = "serve", event, target, ...prompt] = args;
    if (command === "serve" && args.length <= 1) {
        const service = await createCompanion();
        const port = await service.listen();
        output(`Herdr companion listening on 127.0.0.1:${port}`);
        const stop = () => {
            void service.close().catch((e) => {
                console.error(JSON.stringify({ error: String(e) }));
                process.exitCode = 1;
            });
        };
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
        return service;
    }
    if (command !== "wake" || !event || (event !== "cancel" && (!target || !prompt.length)))
        throw new Error("Usage: companion [serve | wake <event> <target> <prompt...> | wake cancel]");
    if (!env.HC_TERMINAL_ID && !env.CODEX_THREAD_ID) throw new Error("HC_TERMINAL_ID or CODEX_THREAD_ID is required");
    const base = env.WINTOS_HERDR_COMPANION_URL ?? "http://127.0.0.1:7732";
    const url = new URL(base);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1")
        throw new Error("Companion URL must use HTTP on 127.0.0.1");
    const response = await fetch(new URL("/wake", url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({
            terminal: env.HC_TERMINAL_ID,
            sessionId: env.CLAUDE_CODE_SESSION_ID,
            codexId: env.CODEX_THREAD_ID,
            callerPid: process.pid,
            codexHome: env.CODEX_HOME ?? join(homedir(), ".codex"),
            event,
            ...(event === "cancel" ? {} : { target, prompt: prompt.join(" ") }),
        }),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(result.error ?? `Companion HTTP ${response.status}`);
    output(JSON.stringify(result));
}

if (typeof require !== "undefined" && require.main === module) {
    void runCli(process.argv.slice(2)).catch((e) => {
        console.error(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        process.exitCode = 1;
    });
}
