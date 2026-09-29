import { homedir } from "os";
import { join } from "path";
import { wintosInstance } from "../instance";
import { startServer } from "./api/server";
import { discoverPlugins, type Plugin } from "./plugins/runner";

const root = process.env.WINTOS_ROOT?.replace(/^~/, homedir()) ?? join(homedir(), ".local/share/wintos/projects");
const { port } = wintosInstance(process.env);

// Core plugins are bundled next to this file and run on the same Node as the daemon.
const core: Plugin[] = [
    { name: "gh-prs", cmd: [process.execPath, join(__dirname, "plugins", "gh-prs.cjs")], env: { ELECTRON_RUN_AS_NODE: "1" }, everyMs: 2 * 60_000 },
];
const plugins = [...core, ...discoverPlugins(join(homedir(), ".config/wintos/plugins"))];

if (process.env.ELECTRON_RUN_AS_NODE) process.stdin.on("end", () => process.exit(0)).resume();

startServer({ root, port, plugins, token: process.env.WINTOS_TOKEN })
    .then(() => console.log(`[wintosd] listening on 127.0.0.1:${port}, projects in ${root}`))
    .catch((e) => {
        console.error(`[wintosd] failed to start: ${e}`);
        process.exit(1);
    });
