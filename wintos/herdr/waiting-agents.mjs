import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function waitingAgentsMod(source) {
  const patches = [
    [/const RANK = \{([^}]+)\};/, "const RANK = {$1, waiting: 1.5};"],
    [/const SECTION = \{([^}]+)\};/, 'const SECTION = {$1, 1.5: "Waiting"};'],
    [/const SECTION_STATUS = \{([^}]+)\};/, 'const SECTION_STATUS = {$1, 1.5: "idle"};'],
    [/let list = agents\(\);/, 'let list = waitingAgents(agents(), shared("wintos.waiting") ?? []);'],
    [
      /if \(a.status === "working"\)/,
      'if (a.status === "waiting") return svg("mods/workspace-chrome/clock.svg").size(12).mx(1).flex_none().text_color(t.idle ?? t.dim).tooltip(a.waitReason ?? "Waiting for an external event");\n    if (a.status === "working")',
    ],
  ];
  for (const [pattern, replacement] of patches) {
    if ((source.match(new RegExp(pattern.source, "g")) ?? []).length !== 1)
      throw Error("Unsupported Herdr agents mod: " + pattern.source);
    source = source.replace(pattern, replacement);
  }
  return 'import { waitingAgents } from "./waiting.js";\n' + source;
}

export function installWaitingAgents(appHome, layout) {
  const source = join(appHome, "mods/agents/main.js");
  if (!existsSync(source)) return;
  const mod = join(appHome, "mods/wintos-agents");
  const adapted = waitingAgentsMod(readFileSync(source, "utf8"));
  mkdirSync(mod, { recursive: true });
  writeFileSync(join(mod, "main.js"), adapted);
  copyFileSync(join(appHome, "mods/wintos-nav/waiting.js"), join(mod, "waiting.js"));
  writeFileSync(join(mod, "mod.json"), JSON.stringify({ place: "none", title: "Agents" }));
  function replace(node) {
    if (node.content?.mod === "agents") node.content.mod = "wintos-agents";
    for (const child of node.children ?? []) replace(child);
  }
  replace(layout);
}
