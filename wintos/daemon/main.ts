import { homedir } from "os";
import { join } from "path";
import { wintosInstance } from "../instance";
import { startServer } from "./api/server";
import { Journal } from "./journal/journal";
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
const journalDir = home(process.env.WINTOS_JOURNAL_DIR);
const journal = journalDir ? new Journal(journalDir, home(process.env.WINTOS_JOURNAL_TEMPLATE) ?? join(journalDir, "..", "templates", "daily_template.md"), join(root, ".day-planned.json")) : undefined;

startServer({ root, port, plugins, token: process.env.WINTOS_TOKEN, journal, lunch: process.env.WINTOS_LUNCH })
    .then(() => console.log(`[wintosd] listening on 127.0.0.1:${port}, projects in ${root}`))
    .catch((e) => {
        console.error(`[wintosd] failed to start: ${e}`);
        process.exit(1);
    });
