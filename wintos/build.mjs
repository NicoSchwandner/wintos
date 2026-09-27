// Bundles the daemon into self-contained CommonJS file that Electron's
// own Node (ELECTRON_RUN_AS_NODE) can run, so WintOS needs no separate Node install.
import { build } from "esbuild";

const common = { bundle: true, platform: "node", target: "node20", format: "cjs", logLevel: "warning" };
await build({ ...common, entryPoints: ["wintos/daemon/main.ts"], outfile: "dist/wintos/wintosd.cjs" });
