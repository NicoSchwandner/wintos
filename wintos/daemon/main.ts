import { homedir } from "os";
import { join } from "path";
import { startServer } from "./api/server";

const root = process.env.WINTOS_ROOT?.replace(/^~/, homedir()) ?? join(homedir(), ".local/share/wintos/projects");
const port = Number(process.env.WINTOS_PORT ?? 7730);

if (process.env.ELECTRON_RUN_AS_NODE) process.stdin.on("end", () => process.exit(0)).resume();

startServer({ root, port })
    .then(() => console.log(`[wintosd] listening on 127.0.0.1:${port}, projects in ${root}`))
    .catch((e) => {
        console.error(`[wintosd] failed to start: ${e}`);
        process.exit(1);
    });
