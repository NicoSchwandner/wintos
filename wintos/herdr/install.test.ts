import {
    chmodSync,
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readlinkSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from "fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "os";
import { join } from "path";
import { expect, test } from "vitest";
import { installFiles } from "./install.mjs";

test.each([
    {
        label: "quoted configured team",
        config: 'WINTOS_TEAM="acme/team-x"\n',
        inherited: undefined,
        expected: "acme/team-x",
    },
    {
        label: "exported configured team",
        config: "export WINTOS_TEAM='acme/team-x' # own team\n",
        inherited: undefined,
        expected: "acme/team-x",
    },
    {
        label: "unquoted configured team",
        config: "WINTOS_TEAM=acme/team-x\n",
        inherited: undefined,
        expected: "acme/team-x",
    },
    {
        label: "inherited override",
        config: "WINTOS_TEAM=acme/team-x\n",
        inherited: "acme/other-team",
        expected: "acme/other-team",
    },
    { label: "explicitly disabled team", config: "WINTOS_TEAM=acme/team-x\n", inherited: "", expected: "" },
    { label: "no configured team", config: undefined, inherited: undefined, expected: undefined },
    { label: "commented-out team", config: "# WINTOS_TEAM=acme/team-x\n", inherited: undefined, expected: undefined },
])("main installs launchd environment with $label", ({ config, inherited, expected }) => {
    const temp = mkdtempSync(join(tmpdir(), "herdr-team-install-"));
    const appHome = join(temp, ".config/herdr-app");
    mkdirSync(join(appHome, "layouts"), { recursive: true });
    mkdirSync(join(temp, ".config/wintos"), { recursive: true });
    writeFileSync(join(appHome, "layouts/main.json"), JSON.stringify({ type: "row", children: [] }));
    const marker = join(temp, "must-not-execute");
    if (config !== undefined)
        writeFileSync(
            join(temp, ".config/wintos/env"),
            config + `UNRELATED_SECRET=synthetic-secret\nUNRELATED_COMMAND=$(touch '${marker}')\n`
        );
    const stub = join(temp, "commands.cjs");
    writeFileSync(
        stub,
        `
const cp = require('node:child_process');
cp.execFileSync = (command) => {
    if (command === '/usr/bin/which') return '/bin/echo\\n';
    if (command === 'launchctl' || command === 'herdr-app') return '';
    throw new Error('Unexpected external command: ' + command);
};
require('node:module').syncBuiltinESMExports();
`
    );
    execFileSync(process.execPath, ["--require", stub, join(__dirname, "install.mjs")], {
        env: {
            HOME: temp,
            PATH: process.env.PATH!,
            WINTOS_ROOT: join(temp, "history"),
            ...(inherited === undefined ? {} : { WINTOS_TEAM: inherited }),
        },
        timeout: 15000,
    });
    const plist = readFileSync(join(temp, "Library/LaunchAgents/local.wintos.herdr-companion.plist"), "utf8");
    if (expected === undefined) expect(plist).not.toContain("<key>WINTOS_TEAM</key>");
    else expect(plist).toContain(`<key>WINTOS_TEAM</key><string>${expected}</string>`);
    expect(plist).not.toContain("UNRELATED_SECRET");
    expect(plist).not.toContain("synthetic-secret");
    expect(plist).not.toContain("UNRELATED_COMMAND");
    expect(existsSync(marker)).toBe(false);
});

test("installs bracket-free shortcuts without changing the shipped layout, existing hooks or sidebar", async () => {
    const temp = mkdtempSync(join(tmpdir(), "herdr-install-"));
    const appHome = join(temp, "app"),
        installRoot = join(temp, "companion"),
        claudeSettings = join(temp, "claude.json");
    mkdirSync(join(appHome, "layouts"), { recursive: true });
    const layout = {
        id: "root",
        type: "row",
        children: [{ id: "sidebar", type: "block", content: { mod: "agents" } }],
    };
    writeFileSync(join(appHome, "layouts/main.json"), JSON.stringify(layout));
    writeFileSync(join(appHome, "shared.json"), JSON.stringify({ layout: "main", unrelated: true }));
    writeFileSync(
        join(appHome, "keys.json"),
        JSON.stringify({
            global: {
                "ctrl-tab": "tab.next",
                "cmd-]": "agent.next",
                "cmd-alt-[": "space.prev",
                "cmd-f9": "custom.action",
            },
            terminal: { "cmd-v": "terminal.paste" },
        })
    );
    writeFileSync(
        join(temp, "shared-claude.json"),
        JSON.stringify({
            hooks: { Stop: [{ hooks: [{ type: "command", command: "existing-hook" }] }] },
            permissions: { allow: ["keep"] },
        })
    );
    chmodSync(join(temp, "shared-claude.json"), 0o600);
    symlinkSync("shared-claude.json", claudeSettings);
    const sourceRoot = join(temp, "source");
    mkdirSync(join(sourceRoot, "mods/wintos-nav"), { recursive: true });
    mkdirSync(join(sourceRoot, "mods/wintos-search"), { recursive: true });
    for (const name of ["wintos-nav", "wintos-search"])
        writeFileSync(join(sourceRoot, "mods", name, "main.js"), "test mod");
    writeFileSync(join(sourceRoot, "hook.sh"), "test hook");
    writeFileSync(join(sourceRoot, "main.ts"), 'console.log(process.argv.slice(2).join("|"))');
    await installFiles({ appHome, installRoot, claudeSettings, sourceRoot, codexExecutable: "/bin/echo" });
    expect(statSync(claudeSettings).mode & 0o777).toBe(0o600);
    expect(lstatSync(claudeSettings).isSymbolicLink()).toBe(true);
    expect(readlinkSync(claudeSettings)).toBe("shared-claude.json");
    const keys = JSON.parse(readFileSync(join(appHome, "keys.json"), "utf8"));
    expect(keys.global).toMatchObject({
        "ctrl-tab": "wintos-nav.next",
        "ctrl-shift-tab": "wintos-nav.prev",
        "cmd-j": "agent.next",
        "cmd-k": "agent.prev",
        "cmd-up": "space.prev",
        "cmd-down": "space.next",
        "cmd-shift-g": "mod.open:wintos-search",
        "cmd-f9": "custom.action",
    });
    expect(keys.global["cmd-]"]).toBeUndefined();
    expect(keys.global["cmd-alt-["]).toBeUndefined();
    expect(keys.terminal["cmd-v"]).toBe("terminal.paste");
    expect(JSON.parse(readFileSync(join(appHome, "layouts/main.json"), "utf8"))).toEqual(layout);
    const cloned = JSON.parse(readFileSync(join(appHome, "layouts/wintos-companion.json"), "utf8"));
    expect(cloned.children[0]).toEqual(layout.children[0]);
    expect(cloned.children.some((n: any) => n.content?.mod === "wintos-nav")).toBe(true);
    expect(cloned.children.find((n: any) => n.content?.mod === "wintos-nav").size.px).toBeGreaterThan(0);
    expect(existsSync(join(installRoot, "backup/keys.json"))).toBe(true);
    expect(statSync(installRoot).mode & 0o777).toBe(0o700);
    await installFiles({ appHome, installRoot, claudeSettings, sourceRoot, codexExecutable: "/bin/echo" });
    const settings = JSON.parse(readFileSync(claudeSettings, "utf8"));
    expect(statSync(claudeSettings).mode & 0o777).toBe(0o600);
    expect(lstatSync(claudeSettings).isSymbolicLink()).toBe(true);
    expect(readlinkSync(claudeSettings)).toBe("shared-claude.json");
    expect(settings.hooks.Stop).toHaveLength(2);
    expect(settings.hooks.Stop[0].hooks[0].command).toBe("existing-hook");
    expect(settings.permissions.allow).toEqual(["keep"]);
    expect(JSON.parse(readFileSync(join(temp, "shared-claude.json"), "utf8"))).toEqual(settings);
    const { execFileSync } = await import("child_process");
    const launch = JSON.parse(readFileSync(join(appHome, "programs.json"), "utf8")).codex.run[0];
    expect(
        execFileSync(launch, ["resume", "thread"], { env: { HC_TERMINAL_ID: "t42" }, encoding: "utf8" }).trim()
    ).toBe('-c shell_environment_policy.set.HC_TERMINAL_ID="t42" resume thread');
    expect(JSON.parse(readFileSync(join(installRoot, "backup/keys.json"), "utf8")).global["ctrl-tab"]).toBe("tab.next");
});

test("installed CLI routes only Herdr wakes and leaves Wave commands with the original CLI", async () => {
    const { execFileSync } = await import("child_process");
    const temp = mkdtempSync(join(tmpdir(), "herdr-cli-"));
    const appHome = join(temp, "app"),
        installRoot = join(temp, "install"),
        binDir = join(temp, "bin"),
        sourceRoot = join(temp, "source");
    mkdirSync(join(appHome, "layouts"), { recursive: true });
    mkdirSync(binDir);
    writeFileSync(join(appHome, "layouts/main.json"), JSON.stringify({ type: "row", children: [] }));
    for (const name of ["wintos-nav", "wintos-search"]) {
        mkdirSync(join(sourceRoot, "mods", name), { recursive: true });
        writeFileSync(join(sourceRoot, "mods", name, "main.js"), "fixture");
    }
    writeFileSync(join(sourceRoot, "hook.sh"), "fixture");
    writeFileSync(join(sourceRoot, "main.ts"), 'console.log(process.argv.slice(2).join("|"))');
    writeFileSync(join(binDir, "wintos"), "#!/bin/sh\necho original:$*\n", { mode: 0o755 });
    await installFiles({ appHome, installRoot, binDir, sourceRoot, claudeSettings: join(temp, "settings.json") });
    const cmd = join(binDir, "wintos");
    const env = { PATH: process.env.PATH!, HOME: temp, HC_TERMINAL_ID: "t7" };
    expect(
        execFileSync(cmd, ["wake", "run", "https://github.com/acme/api/actions/runs/42", "continue"], {
            env,
            encoding: "utf8",
            timeout: 5000,
        }).trim()
    ).toBe("wake|run|https://github.com/acme/api/actions/runs/42|continue");
    expect(
        execFileSync(cmd, ["wake", "green", "acme/api#1", "continue"], {
            env: { ...env, WAVETERM_TABID: "wave" },
            encoding: "utf8",
            timeout: 5000,
        }).trim()
    ).toBe("original:wake green acme/api#1 continue");
    expect(execFileSync(cmd, ["status", "hello"], { env, encoding: "utf8", timeout: 5000 }).trim()).toBe(
        "original:status hello"
    );
    expect(
        execFileSync(cmd, ["wake", "cancel"], {
            env: { PATH: env.PATH, CODEX_THREAD_ID: "thread" },
            encoding: "utf8",
            timeout: 5000,
        }).trim()
    ).toBe("wake|cancel");
    await installFiles({ appHome, installRoot, binDir, sourceRoot, claudeSettings: join(temp, "settings.json") });
    expect(
        execFileSync(cmd, ["title", "test"], { env: { PATH: env.PATH }, encoding: "utf8", timeout: 5000 }).trim()
    ).toBe("original:title test");
});

test("reinstall retries while launchd is still unloading the old service", async () => {
    const { restartAgent } = await import("./install.mjs");
    let attempts = 0,
        running = false;
    await restartAgent("gui/501", "synthetic.service", "/tmp/synthetic.plist", ((_cmd: string, args: string[]) => {
        if (args[0] === "bootstrap") {
            if (++attempts < 3) throw Object.assign(Error("Bootstrap failed: 5: Input/output error"), { status: 5 });
            running = true;
        }
        return "";
    }) as any);
    expect(running).toBe(true);
});

test("a first install tolerates an absent old job but reports a nontransient launch error", async () => {
    const { restartAgent } = await import("./install.mjs");
    await expect(
        restartAgent("gui/501", "synthetic.service", "/tmp/synthetic.plist", ((_cmd: string, args: string[]) => {
            throw Object.assign(Error(args[0] === "bootout" ? "No such service" : "Invalid launch configuration"), {
                status: 1,
            });
        }) as any)
    ).rejects.toThrow("Invalid launch configuration");
});
test("persistent launchd errors stop after bounded retries", async () => {
    const { restartAgent } = await import("./install.mjs");
    await expect(
        restartAgent("gui/501", "synthetic.service", "/tmp/synthetic.plist", (() => {
            throw Object.assign(Error("Still unavailable"), { status: 5 });
        }) as any)
    ).rejects.toThrow("Still unavailable");
});
