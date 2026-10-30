import { homedir } from "os";
import { execFileSync } from "child_process";
import { dirname, join } from "path";
import { wintosInstance } from "../instance";
import { startServer } from "./api/server";
import { Journal } from "./journal/journal";
import { syncWhenQuiet } from "./journal/sync";
import { discoverPlugins, type Plugin } from "./plugins/runner";

const root = process.env.WINTOS_ROOT?.replace(/^~/, homedir()) ?? join(homedir(), ".local/share/wintos/projects");
const { port } = wintosInstance(process.env);

// Core plugins are bundled next to this file and run on the same Node as the daemon.
const core: Plugin[] = [
    { name: "gh-prs", cmd: [process.execPath, join(__dirname, "plugins", "gh-prs.cjs")], env: { ELECTRON_RUN_AS_NODE: "1" }, everyMs: 2 * 60_000 },
    // Only with a calendar to read: WINTOS_CALENDAR_ICS in ~/.config/wintos/env.
    ...(process.env.WINTOS_CALENDAR_ICS ? [{ name: "calendar", cmd: [process.execPath, join(__dirname, "plugins", "calendar.cjs")], env: { ELECTRON_RUN_AS_NODE: "1" }, everyMs: 5 * 60_000 }] : []),
];
const plugins = [...core, ...discoverPlugins(join(homedir(), ".config/wintos/plugins"))];

if (process.env.ELECTRON_RUN_AS_NODE) process.stdin.on("end", () => process.exit(0)).resume();

// A daily journal behind the Today page: WINTOS_JOURNAL_DIR holds YYYY/MM/YYYY-MM-DD.md, made from
// WINTOS_JOURNAL_TEMPLATE. Which days were planned is WintOS's own, kept beside the projects.
const home = (p?: string) => p?.replace(/^~/, homedir());
// A setting in minutes (0 turns its feature off), as milliseconds; unset or unreadable: the default.
const minutes = (v: string | undefined, fallback: number) => (v !== undefined && /^\d+$/.test(v.trim()) ? Number(v) : fallback) * 60_000;
const journalDir = home(process.env.WINTOS_JOURNAL_DIR);
// WINTOS_JOURNAL_NEW: the journal's own command that makes today's file, run from the journal's
// parent folder (e.g. `work-journal new`); it must leave an existing day alone.
const newDay = process.env.WINTOS_JOURNAL_NEW;
const journal = journalDir
    ? new Journal(journalDir, home(process.env.WINTOS_JOURNAL_TEMPLATE) ?? join(journalDir, "..", "templates", "daily_template.md"), join(root, ".day-planned.json"), newDay ? () => void execFileSync("/bin/sh", ["-c", newDay], { cwd: dirname(journalDir), timeout: 20_000, stdio: "ignore" }) : undefined)
    : undefined;

startServer({ root, port, plugins, token: process.env.WINTOS_TOKEN, journal, onJournalChange: journalDir && process.env.WINTOS_JOURNAL_GIT === "1" ? syncWhenQuiet(journalDir) : undefined, lunch: process.env.WINTOS_LUNCH, workday: process.env.WINTOS_WORKDAY, recapCmd: process.env.WINTOS_RECAP_CMD, recapExtra: process.env.WINTOS_RECAP_EXTRA, fixCmd: process.env.WINTOS_FIX_CMD, fixCwd: process.env.WINTOS_FIX_CWD?.replace(/^~/, homedir()), repoNamesFile: home(process.env.WINTOS_REPO_NAMES) ?? join(homedir(), ".config/wintos/repos.json"), claudeDirs: [home(process.env.WINTOS_CLAUDE_DIR) ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude")], checkout: __dirname, moveEveryMs: minutes(process.env.WINTOS_MOVE_EVERY, 30), batchEveryMs: minutes(process.env.WINTOS_BATCH_EVERY, 20) })
    .then(() => console.log(`[wintosd] listening on 127.0.0.1:${port}, projects in ${root}`))
    .catch((e) => {
        console.error(`[wintosd] failed to start: ${e}`);
        process.exit(1);
    });
