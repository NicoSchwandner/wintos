import { execFileSync } from "child_process";
import { build } from "esbuild";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { parseEnv } from "node:util";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
const read = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback);
function write(file, value) {
  if (lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) file = realpathSync(file);
  const mode = (lstatSync(file, { throwIfNoEntry: false })?.mode ?? 0o600) & 0o777;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2) + "\n", { mode });
  chmodSync(`${file}.tmp`, mode);
  renameSync(`${file}.tmp`, file);
}

export async function installFiles({
  appHome,
  installRoot,
  claudeSettings,
  binDir = undefined,
  codexExecutable = undefined,
  sourceRoot = dirname(fileURLToPath(import.meta.url)),
}) {
  const backup = join(installRoot, "backup");
  mkdirSync(installRoot, { recursive: true, mode: 0o700 });
  chmodSync(installRoot, 0o700);
  mkdirSync(backup, { recursive: true });
  for (const [file, name] of [
    [join(appHome, "keys.json"), "keys.json"],
    [join(appHome, "shared.json"), "shared.json"],
    [join(appHome, "programs.json"), "programs.json"],
    [claudeSettings, "claude-settings.json"],
  ]) {
    if (existsSync(file) && !existsSync(join(backup, name))) copyFileSync(file, join(backup, name));
  }
  await build({
    entryPoints: [join(sourceRoot, "main.ts")],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    outfile: join(installRoot, "companion.cjs"),
    logLevel: "warning",
  });
  copyFileSync(join(sourceRoot, "hook.sh"), join(installRoot, "hook.sh"));
  for (const name of ["wintos-nav", "wintos-search"])
    cpSync(join(sourceRoot, "mods", name), join(appHome, "mods", name), { recursive: true });
  installCli(binDir, installRoot, backup);
  if (codexExecutable) installCodex(appHome, installRoot, codexExecutable);
  installKeys(appHome);
  installLayout(appHome);
  installHooks(claudeSettings, installRoot);
}

function installCli(binDir, installRoot, backup) {
  if (binDir) {
    mkdirSync(binDir, { recursive: true });
    const originalFile = join(installRoot, "original-cli.json");
    let original = read(originalFile, null);
    const cli = join(binDir, "wintos");
    const wrapper = join(installRoot, "wintos");
    if (existsSync(cli)) {
      const target = realpathSync(cli);
      const managed = existsSync(wrapper) ? realpathSync(wrapper) : wrapper;
      if (target !== managed) {
        if (!lstatSync(cli).isSymbolicLink()) {
          const saved = join(backup, "original-wintos");
          if (!existsSync(saved)) copyFileSync(target, saved);
          original = join(binDir, ".wintos-herdr-original");
          copyFileSync(target, original);
        } else original = target;
      }
    }
    if (original === join(backup, "original-wintos")) {
      const adjacent = join(binDir, ".wintos-herdr-original");
      copyFileSync(original, adjacent);
      original = adjacent;
    }
    if (original) {
      write(originalFile, original);
      writeFileSync(
        wrapper,
        `#!/bin/sh
if [ -z "\${WAVETERM_TABID:-}" ] && [ -z "\${WAVETERM_BLOCKID:-}" ] && [ "\${1:-}" = wake ] && { [ -n "\${HC_TERMINAL_ID:-}" ] || [ -n "\${CODEX_THREAD_ID:-}" ]; }; then
    exec ${quote(process.execPath)} ${quote(join(installRoot, "companion.cjs"))} "$@"
fi
exec ${quote(original)} "$@"
`,
        { mode: 0o755 }
      );
      symlinkSync(wrapper, join(binDir, "wintos.next"));
      renameSync(join(binDir, "wintos.next"), join(binDir, "wintos"));
    }
  }
}

function installCodex(appHome, installRoot, executable) {
  const wrapper = join(installRoot, "codex");
  writeFileSync(
    wrapper,
    `#!/bin/sh
if [ -n "\${HC_TERMINAL_ID:-}" ]; then
    exec ${quote(executable)} -c "shell_environment_policy.set.HC_TERMINAL_ID=\\\"\${HC_TERMINAL_ID}\\\"" "$@"
fi
exec ${quote(executable)} "$@"
`,
    { mode: 0o755 }
  );
  const programs = read(join(appHome, "programs.json"), {});
  programs.codex = { ...programs.codex, run: [wrapper] };
  write(join(appHome, "programs.json"), programs);
}

function installKeys(appHome) {
  const keys = read(join(appHome, "keys.json"), {});
  const global = (keys.global ??= {});
  for (const key of ["cmd-]", "cmd-[", "cmd-shift-]", "cmd-shift-[", "cmd-alt-]", "cmd-alt-["]) {
    if (["agent.next", "agent.prev", "tab.next", "tab.prev", "space.next", "space.prev"].includes(global[key]))
      delete global[key];
  }
  Object.assign(global, {
    "ctrl-tab": "wintos-nav.next",
    "ctrl-shift-tab": "wintos-nav.prev",
    "cmd-j": "agent.next",
    "cmd-k": "agent.prev",
    "cmd-up": "space.prev",
    "cmd-down": "space.next",
    "cmd-shift-right": "tab.next",
    "cmd-shift-left": "tab.prev",
    "cmd-shift-g": "mod.open:wintos-search",
  });
  write(join(appHome, "keys.json"), keys);
}

function installLayout(appHome) {
  const shared = read(join(appHome, "shared.json"), {});
  const name = "wintos-companion";
  const source = shared.layout && shared.layout !== name ? shared.layout : "main";
  const file = join(appHome, "layouts", `${name}.json`);
  const layout = read(file, read(join(appHome, "layouts", `${source}.json`), null));
  if (!layout || !Array.isArray(layout.children)) throw Error("The active Herdr layout must have a row or column root");
  if (!layout.children.some((n) => n.id === "wintos-companion-commands"))
    layout.children.push({
      id: "wintos-companion-commands",
      type: "block",
      size: { px: 1 },
      min: 0,
      content: { mod: "wintos-nav" },
    });
  const commands = layout.children.find((n) => n.id === "wintos-companion-commands");
  commands.hidden = false;
  commands.size = { px: 1 };
  write(file, layout);
  write(join(appHome, "shared.json"), { ...shared, layout: name });
}

function installHooks(claudeSettings, installRoot) {
  const settings = read(claudeSettings, {});
  const hooks = (settings.hooks ??= {});
  const command = `/bin/sh ${quote(join(installRoot, "hook.sh"))}`;
  for (const event of ["SessionStart", "UserPromptSubmit", "Stop", "SessionEnd", "PostToolUse"]) {
    const entries = (hooks[event] ??= []);
    if (!entries.some((e) => e.hooks?.some((h) => h.command === command)))
      entries.push({
        ...(event === "PostToolUse" ? { matcher: "Bash" } : {}),
        hooks: [{ type: "command", command, timeout: 3 }],
      });
  }
  write(claudeSettings, settings);
}

function xml(s) {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function agentEnvironment(home) {
  const config = join(home, ".config/wintos/env");
  const settings = existsSync(config)
    ? parseEnv(
        readFileSync(config, "utf8")
          .split(/\r?\n/)
          .filter((line) => /^\s*(?:export\s+)?WINTOS_(TEAM|ROOT)\s*=/.test(line))
          .join("\n")
      )
    : {};
  const team = process.env.WINTOS_TEAM ?? settings.WINTOS_TEAM;
  const historyRoot = process.env.WINTOS_ROOT ?? settings.WINTOS_ROOT;
  return {
    PATH: process.env.PATH ?? "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
    ...(historyRoot ? { WINTOS_ROOT: historyRoot.replace(/^(\$\{HOME\}|\$HOME|~)(?=\/|$)/, () => home) } : {}),
    ...(team == null ? {} : { WINTOS_TEAM: team }),
  };
}

export async function restartAgent(domain, label, plist, run = execFileSync) {
  try {
    run("launchctl", ["bootout", `${domain}/${label}`], { stdio: "ignore" });
  } catch {}
  const attempts = 5;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      run("launchctl", ["bootstrap", domain, plist], { stdio: "pipe" });
      return;
    } catch (error) {
      if (error.status !== 5 || attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
}

async function main() {
  const home = homedir(),
    appHome = process.env.HERDR_APP_HOME ?? join(home, ".config/herdr-app");
  const installRoot = join(home, ".local/share/wintos-herdr-companion");
  const claudeSettings = join(process.env.CLAUDE_CONFIG_DIR ?? join(home, ".claude"), "settings.json");
  let codexExecutable;
  try {
    codexExecutable = execFileSync("/usr/bin/which", ["codex"], { encoding: "utf8" }).trim();
  } catch {}
  await installFiles({ appHome, installRoot, claudeSettings, binDir: join(home, ".local/bin"), codexExecutable });
  for (const name of ["wintos-nav", "wintos-search"])
    execFileSync("herdr-app", ["check", join(appHome, "mods", name)], { stdio: "inherit" });
  const label = "local.wintos.herdr-companion";
  const plist = join(home, "Library/LaunchAgents", `${label}.plist`);
  mkdirSync(dirname(plist), { recursive: true });
  const env = agentEnvironment(home);
  if (!env.WINTOS_ROOT) {
    try {
      const state = await (await fetch("http://127.0.0.1:7730/state", { signal: AbortSignal.timeout(3000) })).json();
      const dir = state.projects?.find((p) => p.dir)?.dir;
      if (dir) env.WINTOS_ROOT = dirname(dir);
    } catch {}
  }
  writeFileSync(
    plist,
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(join(installRoot, "companion.cjs"))}</string><string>serve</string></array><key>EnvironmentVariables</key><dict>${Object.entries(
      env
    )
      .map(([k, v]) => `<key>${k}</key><string>${xml(v)}</string>`)
      .join(
        ""
      )}</dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>StandardOutPath</key><string>${xml(join(installRoot, "service.log"))}</string><key>StandardErrorPath</key><string>${xml(join(installRoot, "service.log"))}</string></dict></plist>`
  );
  const domain = `gui/${process.getuid()}`;
  await restartAgent(domain, label, plist);
  try {
    execFileSync("herdr-app", ["do", "layout.switch", "--name", "wintos-companion"], { stdio: "inherit" });
  } catch {}
  console.log(`Installed companion; backups in ${join(installRoot, "backup")}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
