import { execFile } from "child_process";
import { statSync } from "fs";
import { basename, join } from "path";
import { resumeScriptOf, type Session } from "../sessions/reduce";
import { shelvedName, type Shelf } from "../shelf/shelf";

// Who owns a PR, and how something said about it reaches them: typed into their pane between
// turns, sent through Claude's background service, resumed in their pane first (paused or not yet
// started since a restart), or resumed headless (ended or shelved: always, however long ago).
export type OwnerRoute = "pane" | "background" | "paused" | "shelved" | "none";
export type Owner = { route: OwnerRoute; sessionId?: string; name?: string; epic?: string; script?: string };

const nameOf = (s: Session) => s.name?.text ?? s.label ?? s.id.slice(0, 8);

export function ownerOf(url: string, sessions: Session[], shelf: Shelf): Owner {
    const holders = sessions.filter((s) => s.prs?.includes(url));
    const live = holders.find((s) => s.state !== "ended");
    if (live) {
        const at = { sessionId: live.id, name: nameOf(live), ...(live.epic ? { epic: live.epic } : {}) };
        if (live.bgId && !live.attachedTo) return { route: "background", ...at };
        if (!live.restored) return { route: "pane", ...at };
        const script = resumeScriptOf(live);
        return script && live.blockId ? { route: "paused", ...at, script } : { route: "none" };
    }
    const ended = holders.map((s) => ({ s, script: resumeScriptOf(s) })).find((x) => x.script);
    if (ended) return { route: "shelved", sessionId: ended.s.id, name: nameOf(ended.s), ...(ended.s.epic ? { epic: ended.s.epic } : {}), script: ended.script };
    const kept = Object.values(shelf).flat().find((i) => i.prs?.includes(url));
    if (kept) return { route: "shelved", sessionId: kept.sessionId, name: shelvedName(kept), ...(kept.epic ? { epic: kept.epic } : {}), script: kept.script };
    return { route: "none" };
}

// A PR whose owner could not be found, was found only in a transcript, or that a session took
// over: each line is a case of PR registration missing a PR, kept for whoever fixes registration
// (WintOS heads-up, /evolve).
export type Gap = { at: number; pr: string; kind: "no-owner" | "took-over" | "found-in-transcript"; by?: string; byName?: string; reason?: string; found?: string; checked: string[] };
export const GAP_SOURCES = ["live sessions", "ended sessions", "shelf", "transcripts (30 days)"];

// The registry has no owner: the session that opened the PR still has it in its transcript, where
// the link first appears (the create command's output, or a lander's "PR: <link>"). Of the
// transcripts that name it, the one naming it first. Only the last 30 days, and no subagent's own.
// running: written to in the last 10 minutes, so it may be at work right now outside WintOS, and
// resuming it would run it twice.
export type Found = { sessionId: string; cwd?: string; configDir: string; running: boolean };
const RECENT_MS = 10 * 60_000;

export async function searchTranscripts(url: string, configDirs: string[], now = Date.now()): Promise<Found | undefined> {
    const hits: { file: string; configDir: string; at: number; cwd?: string }[] = [];
    for (const configDir of configDirs) {
        const files = await run("/bin/sh", ["-c", `find "$0" -name '*.jsonl' -mtime -30 -not -path '*/subagents/*' -print0 | xargs -0 grep -lF -- "$1"`, join(configDir, "projects"), url]);
        for (const file of files.split("\n").filter(Boolean)) {
            const line = (await run("grep", ["-m1", "-F", "--", url, file])).split("\n")[0];
            try {
                const row = JSON.parse(line) as { timestamp?: string; cwd?: string };
                hits.push({ file, configDir, at: Date.parse(row.timestamp ?? "") || Infinity, ...(row.cwd ? { cwd: row.cwd } : {}) });
            } catch {}
        }
    }
    const first = hits.sort((a, b) => a.at - b.at)[0];
    if (!first) return undefined;
    return { sessionId: basename(first.file, ".jsonl"), ...(first.cwd ? { cwd: first.cwd } : {}), configDir: first.configDir, running: now - statSync(first.file).mtimeMs < RECENT_MS };
}

// How a session found that way is resumed: in its directory, in its own Claude account.
export function resumeOfFound(f: Found, home: string): string | undefined {
    if (!f.cwd) return undefined;
    const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
    const account = f.configDir === join(home, ".claude") ? "" : `CLAUDE_CONFIG_DIR=${q(f.configDir)} `;
    return `cd ${q(f.cwd)} && ${account}claude --resume ${q(f.sessionId)}`;
}

const run = (cmd: string, args: string[]) => new Promise<string>((resolve) => execFile(cmd, args, { timeout: 30_000, maxBuffer: 8 << 20 }, (_e, out) => resolve(String(out ?? ""))));
