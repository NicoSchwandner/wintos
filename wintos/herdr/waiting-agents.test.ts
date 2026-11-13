import { transformSync } from "esbuild";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, test } from "vitest";
import { waitingAgentsMod } from "./waiting-agents.mjs";

const fixture = `
import { agents, shared } from "herdr";
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1: "Idle" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };
export default class Agents {
    status(t, a) {
        if (a.status === "working") return "spinner";
        return "idle";
    }
    render() {
        let list = agents();
        return list.sort((a,b) => RANK[b.status]-RANK[a.status]).map(a=>[a.address,SECTION[RANK[a.status]],a.waitReason]);
    }
}`;
function render(waits: unknown[], status = "done") {
    const helper = { exports: {} as any };
    runInNewContext(
        transformSync(readFileSync(`${__dirname}/mods/wintos-nav/waiting.js`, "utf8"), { format: "cjs" }).code,
        { module: helper, exports: helper.exports }
    );
    const module = { exports: {} as any };
    runInNewContext(transformSync(waitingAgentsMod(fixture), { format: "cjs" }).code, {
        module,
        exports: module.exports,
        require: (name: string) =>
            name.includes("waiting.js")
                ? helper.exports
                : {
                      agents: () => [
                          { address: "idle", status: "idle" },
                          { address: "waiting", status },
                          { address: "working", status: "working" },
                      ],
                      shared: () => waits,
                  },
    });
    return JSON.parse(JSON.stringify(new module.exports.default().render()));
}
test("cloned native list puts a pending external wait between Working and Idle", () => {
    expect(
        render([{ terminal: "waiting", event: "run", target: "https://github.com/acme/widgets/actions/runs/123" }])
    ).toEqual([
        ["working", "Working", null],
        ["waiting", "Waiting", "run: https://github.com/acme/widgets/actions/runs/123"],
        ["idle", "Idle", null],
    ]);
});
test.each(["working", "blocked"])("an external wait does not hide %s status", (status) => {
    const rows = render(
        [{ terminal: "waiting", event: "green", target: "https://github.com/acme/widgets/pull/42" }],
        status
    );
    expect(rows.find((row: any) => row[0] === "waiting")[1]).toBe(status === "working" ? "Working" : "Needs you");
});
test("delivered or cancelled waits restore the native Done section", () => {
    expect(render([]).find((row: any) => row[0] === "waiting")[1]).toBe("Done");
});
test("incompatible native source fails explicitly rather than quietly misgrouping", () => {
    expect(() => waitingAgentsMod("export default class Agents {} ")).toThrow("Unsupported Herdr agents mod");
});
