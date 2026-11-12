import { describe, expect, test } from "vitest";
import { pausable, paneClaudes, parsePs } from "./pause";
import type { Session } from "./reduce";

const H = 3_600_000, now = 100 * H;
const s = (id: string, o: Partial<Session> = {}): Session => ({ id, tabId: "t", blockId: `b-${id}`, state: "idle", since: 0, lastAt: now - 9 * H, ...o });

describe("pausable", () => {
    const all = [
        s("idle"),
        s("waiting", { state: "waiting" }),
        s("working", { state: "working" }),
        s("subagent", { subagents: { a: now - 1000 } }),
        s("bg", { bgId: "abc" }),
        s("restored", { restored: true }),
        s("ended", { state: "ended" }),
        s("reading", { reading: true }),
        s("focused"),
        s("recent", { lastAt: now - H }),
        s("seen"),
    ];
    const seen = new Map([["seen", now - 2 * H]]);
    test("on an update: every pane session between turns, running nothing, but the one you are at", () =>
        expect(pausable(all, now, seen, "focused").map((x) => x.id)).toEqual(["idle", "waiting", "recent", "seen"]));
    test("on the timer: only those also untouched and unseen for the whole time", () =>
        expect(pausable(all, now, seen, "focused", 8 * H).map((x) => x.id)).toEqual(["idle", "waiting"]));
});

describe("paneClaudes", () => {
    const ps = parsePs(`  10     1   1-02:00:00 /bin/zsh
  11    10   1-01:59:58 claude --resume 'x'
  12    11   1-01:59:50 dotnet /mcp/Server.dll
  13    11   1-01:59:40 node /mcp/other.js
  20     1      2:00:00 -zsh
  21    20      1:59:59 /Users/n/.local/share/claude/versions/2.1.322 --resume y
  22    21      1:59:55 dotnet /mcp/Server.dll
  23    21        00:30 /bin/zsh -c -l source snapshot && gh pr checks --watch
  30     1      5:00:00 /bin/zsh
  31    30      4:00:00 vim notes.md
  40     1      3:00:00 /bin/zsh
  41    40      2:00:00 /bin/sh /usr/bin/command claude --model haiku
  42    41      2:00:00 claude --model haiku
  43    42      1:59:58 dotnet /mcp/Server.dll`);
    test("ps's elapsed time, days and hours included", () => expect(ps.find((p) => p.pid === 10)?.age).toBe(26 * 3600));
    test("a pane's Claude is idle with only its MCP servers, at work while it runs a command; a pane without one has none", () =>
        expect([...paneClaudes(ps, new Map([["a", 10], ["b", 20], ["c", 30]]))]).toEqual([["a", { pid: 11, busy: false }], ["b", { pid: 21, busy: true }]]));
    test("a Claude started through a wrapper (`command claude`) is found below it, the wrapper isn't taken for it", () =>
        expect(paneClaudes(ps, new Map([["d", 40]])).get("d")).toEqual({ pid: 42, busy: false }));
});
