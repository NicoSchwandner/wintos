import { describe, expect, test } from "vitest";
import { parseFootprint, roleOf, wintosProcesses } from "./memory";

const PS = ` 100     1 /x/Electron.app/Contents/MacOS/Electron .
 101   100 /x/Electron Helper (Renderer) --type=renderer --foo
 102   100 /x/Electron /y/dist/wintos/wintosd.cjs
 103   102 /x/Electron /y/dist/wintos/plugins/gh-prs.cjs
 200     1 /Applications/Slack.app/Slack
 201   200 /Applications/Slack Helper --type=renderer`;

describe("memory", () => {
    test("WintOS's processes are its main, its children and theirs, nobody else's", () =>
        expect(wintosProcesses(PS, 100).map((p) => p.pid)).toEqual([100, 101, 102, 103]));
    test("each is named for what it does", () =>
        expect(wintosProcesses(PS, 100).map((p) => roleOf(p.command, 100, p.pid))).toEqual(["main", "renderer", "daemon", "plugin gh-prs"]));
    test("footprint's per-process lines, in MB", () =>
        expect([...parseFootprint("Electron Helper [101]: 64-bit    Footprint: 1.5 GB (16384 bytes per page)\nShared with Electron [100]:\nElectron [100]: 64-bit    Footprint: 97 MB (x)\nfoo [5]: 64-bit    Footprint: 512 KB (x)")]).toEqual([[101, 1536], [100, 97], [5, 1]]));
});
