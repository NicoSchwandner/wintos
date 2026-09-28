import { chmodSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, test } from "vitest";
import { discoverPlugins, PluginRunner } from "./runner";

const script = (body: string) => {
    const dir = mkdtempSync(join(tmpdir(), "wintos-plug-"));
    const f = join(dir, "p");
    writeFileSync(f, `#!/bin/sh\n${body}\n`);
    chmodSync(f, 0o755);
    return f;
};

describe("PluginRunner", () => {
    test("stores a plugin's JSON under its name", async () => {
        const r = new PluginRunner([{ name: "x", cmd: [script(`echo '{"n":1}'`)], everyMs: 0 }], () => {});
        await r.run("x");
        expect(r.results.x).toMatchObject({ ok: true, data: { n: 1 } });
    });

    test("a failing run keeps the last good data and says why", async () => {
        const f = script(`[ -f "$0.fail" ] && { echo boom >&2; exit 3; }; echo '{"n":1}'; touch "$0.fail"`);
        const r = new PluginRunner([{ name: "x", cmd: [f], everyMs: 0 }], () => {});
        await r.run("x");
        await r.run("x");
        expect(r.results.x).toMatchObject({ ok: false, data: { n: 1 } });
        expect(r.results.x.error).toContain("boom");
    });

    test("output that isn't JSON is an error, not data", async () => {
        const r = new PluginRunner([{ name: "x", cmd: [script("echo not json")], everyMs: 0 }], () => {});
        await r.run("x");
        expect(r.results.x).toMatchObject({ ok: false });
        expect(r.results.x.data).toBeUndefined();
    });

    test("a hung plugin is killed at its timeout", async () => {
        const r = new PluginRunner([{ name: "x", cmd: [script("sleep 5")], everyMs: 0, timeoutMs: 200 }], () => {});
        const t = Date.now();
        await r.run("x");
        expect(Date.now() - t).toBeLessThan(2000);
        expect(r.results.x).toMatchObject({ ok: false });
    });

    test("every run is announced when it starts and when its result is in", async () => {
        let n = 0;
        const r = new PluginRunner([{ name: "x", cmd: [script(`echo '{}'`)], everyMs: 0 }], () => n++);
        await r.run("x");
        expect(n).toBe(2);
    });

    test("overlapping runs share one process, so a slow old run can't overwrite a newer result", async () => {
        const f = script(`n=$(cat "$0.n" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$0.n"; sleep 0.3; echo "{\\"n\\":$n}"`);
        const r = new PluginRunner([{ name: "x", cmd: [f], everyMs: 0 }], () => {});
        await Promise.all([r.run("x"), r.run("x"), r.run("x")]);
        expect(require("fs").readFileSync(f + ".n", "utf8").trim()).toBe("1");
        expect(r.results.x.data).toEqual({ n: 1 });
    });

    test("a null env value removes the variable from the plugin's environment", async () => {
        process.env.WINTOS_TEST_VAR = "set";
        const r = new PluginRunner([{ name: "x", cmd: [script(`echo "{\\"v\\":\\"\${WINTOS_TEST_VAR-unset}\\"}"`)], env: { WINTOS_TEST_VAR: null }, everyMs: 0 }], () => {});
        await r.run("x");
        delete process.env.WINTOS_TEST_VAR;
        expect(r.results.x.data).toEqual({ v: "unset" });
    });

    test("says which plugins exist and which are running, so the UI can show them loading", async () => {
        const seen: string[][] = [];
        const r = new PluginRunner([{ name: "x", cmd: [script(`echo '{}'`)], everyMs: 0 }, { name: "y", cmd: [script(`echo '{}'`)], everyMs: 0 }], () => seen.push(r.running));
        expect(r.names).toEqual(["x", "y"]);
        expect(r.running).toEqual([]);
        await r.run("x");
        expect(seen[0]).toEqual(["x"]); // announced when it starts
        expect(r.running).toEqual([]);
    });

    test("an unknown plugin is refused", async () => {
        const r = new PluginRunner([], () => {});
        expect(await r.run("nope")).toBe(false);
    });
});

describe("discoverPlugins", () => {
    test("every executable in the user plugin folder, named after the file", () => {
        const dir = mkdtempSync(join(tmpdir(), "wintos-plugdir-"));
        writeFileSync(join(dir, "status-check"), "#!/bin/sh\necho {}\n", { mode: 0o755 });
        writeFileSync(join(dir, "README.md"), "not a plugin");
        expect(discoverPlugins(dir).map((p) => p.name)).toEqual(["status-check"]);
    });

    test("user plugins get a long timeout and none of WintOS's Electron-as-Node setting", () => {
        const dir = mkdtempSync(join(tmpdir(), "wintos-plugdir-"));
        writeFileSync(join(dir, "p"), "#!/bin/sh\necho {}\n", { mode: 0o755 });
        expect(discoverPlugins(dir)[0]).toMatchObject({ timeoutMs: 90_000, env: { ELECTRON_RUN_AS_NODE: null } });
    });

    test("a missing folder means no user plugins", () => expect(discoverPlugins("/nonexistent/wintos")).toEqual([]));
});
