import { transformSync } from "esbuild";
import { readFileSync } from "fs";
import { expect, test } from "vitest";
import { runInNewContext } from "vm";

function host(list: { address: string; status: string }[], current?: string, commands: string[] = []) {
    const effects: unknown[] = [];
    const module = { exports: {} as any };
    const code = transformSync(readFileSync(`${__dirname}/mods/wintos-nav/main.js`, "utf8"), { format: "cjs" }).code;
    runInNewContext(code, {
        module,
        exports: module.exports,
        require: (name: string) =>
            name === "gpui-kit"
                ? { View: class {} }
                : {
                      nextCommand: () => (commands.length ? Promise.resolve(commands.shift()) : new Promise(() => {})),
                      agents: () => list,
                      focused: () => ({ terminal: current }),
                      run: (command: string, args: unknown) => effects.push([command, args]),
                  },
    });
    return { mod: new module.exports.default(), effects };
}

test("Ctrl-Tab goes to the next blocked or unread agent, skipping working and idle", () => {
    const h = host(
        [
            { address: "t1", status: "blocked" },
            { address: "t2", status: "working" },
            { address: "t3", status: "idle" },
            { address: "t4", status: "done" },
        ],
        "t1"
    );
    h.mod.command("next");
    expect(h.effects).toEqual([["agent.focus", { terminal: "t4" }]]);
});
test("reverse attention navigation wraps to the last eligible agent", () => {
    const h = host(
        [
            { address: "t1", status: "blocked" },
            { address: "t2", status: "working" },
            { address: "t3", status: "done" },
        ],
        "t1"
    );
    h.mod.command("prev");
    expect(h.effects).toEqual([["agent.focus", { terminal: "t3" }]]);
});
test("the currently read done agent turning idle does not reset the place in the cycle", () => {
    const h = host(
        [
            { address: "t1", status: "blocked" },
            { address: "t2", status: "idle" },
            { address: "t3", status: "done" },
        ],
        "t2"
    );
    h.mod.command("next");
    expect(h.effects).toEqual([["agent.focus", { terminal: "t3" }]]);
});
test.each(["next", "prev"])("no other eligible session leaves focus alone (%s)", (c) => {
    const h = host(
        [
            { address: "t1", status: "blocked" },
            { address: "t2", status: "idle" },
        ],
        "t1"
    );
    h.mod.command(c);
    expect(h.effects).toEqual([]);
});
test("no focused agent starts at the first attention item", () => {
    const h = host([
        { address: "t1", status: "working" },
        { address: "t2", status: "done" },
    ]);
    h.mod.command("next");
    expect(h.effects).toEqual([["agent.focus", { terminal: "t2" }]]);
});
test("unknown commands and an empty list do nothing", () => {
    const h = host([]);
    h.mod.command("other");
    h.mod.command("next");
    expect(h.effects).toEqual([]);
});

test("the registered command loop routes Ctrl-Tab events into attention navigation", async () => {
    const h = host(
        [
            { address: "t1", status: "working" },
            { address: "t2", status: "blocked" },
        ],
        "t1",
        ["next"]
    );
    h.mod.init({}, { spawn: (f: any) => void f({ notify: () => {} }) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.effects).toEqual([["agent.focus", { terminal: "t2" }]]);
});
