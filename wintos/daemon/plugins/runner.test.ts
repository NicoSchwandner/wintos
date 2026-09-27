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

    test("every result is announced", async () => {
        let n = 0;
        const r = new PluginRunner([{ name: "x", cmd: [script(`echo '{}'`)], everyMs: 0 }], () => n++);
        await r.run("x");
        expect(n).toBe(1);
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

    test("a missing folder means no user plugins", () => expect(discoverPlugins("/nonexistent/wintos")).toEqual([]));
});
