import { transformSync } from "esbuild";
import { readFileSync } from "fs";
import { expect, test } from "vitest";
import { runInNewContext } from "vm";

function host(
    list: { address: string; status: string }[],
    current?: string,
    commands: string[] = [],
    waiting: unknown[] = []
) {
    const effects: unknown[] = [];
    const requests: string[] = [];
    let response = async () => ({ ok: true, json: async () => waiting });
    const module = { exports: {} as any };
    const helper = { exports: {} as any };
    runInNewContext(
        transformSync(readFileSync(`${__dirname}/mods/wintos-nav/waiting.js`, "utf8"), { format: "cjs" }).code,
        { module: helper, exports: helper.exports }
    );
    const code = transformSync(readFileSync(`${__dirname}/mods/wintos-nav/main.js`, "utf8"), { format: "cjs" }).code;
    runInNewContext(code, {
        module,
        fetch: async (url: string) => {
            requests.push(url);
            return response();
        },
        exports: module.exports,
        require: (name: string) =>
            name === "./waiting.js"
                ? helper.exports
                : name === "gpui-kit"
                  ? { View: class {} }
                  : {
                        nextCommand: () =>
                            commands.length ? Promise.resolve(commands.shift()) : new Promise(() => {}),
                        agents: () => list,
                        shared: () => waiting,
                        setShared: (_key: string, value: unknown[]) => {
                            waiting = value;
                        },
                        focused: () => ({ terminal: current }),
                        run: (command: string, args: unknown) => effects.push([command, args]),
                    },
    });
    return {
        mod: new module.exports.default(),
        effects,
        requests,
        getWaiting: () => waiting,
        setResponse: (r: any) => {
            response = r;
        },
    };
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
    h.mod.init({}, { timer: { every: () => {} }, spawn: (f: any) => void f({ notify: () => {} }) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.effects).toEqual([["agent.focus", { terminal: "t2" }]]);
});

test("attention navigation skips a completed turn that is waiting on an external event", () => {
    const h = host(
        [
            { address: "t1", status: "idle" },
            { address: "t2", status: "done" },
            { address: "t3", status: "blocked" },
        ],
        "t1",
        [],
        [{ terminal: "t2", event: "run", target: "https://github.com/acme/widgets/actions/runs/123" }]
    );
    h.mod.command("next");
    expect(h.effects).toEqual([["agent.focus", { terminal: "t3" }]]);
});

test("initialization publishes wait state and the timer refresh clears it when delivered", async () => {
    const h = host([], undefined, [], []);
    let tick: any;
    const cx: any = {
        notify: () => {},
        spawn: (f: any) => void f(cx),
        timer: {
            every: (ms: number, f: any) => {
                expect(ms).toBe(5000);
                tick = f;
            },
        },
    };
    h.setResponse(async () => ({
        ok: true,
        json: async () => [
            { terminal: "t2", event: "run", target: "https://github.com/acme/widgets/actions/runs/123" },
        ],
    }));
    h.mod.init({}, cx);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.requests).toEqual(["http://127.0.0.1:7732/waiting"]);
    expect(h.getWaiting()).toHaveLength(1);
    h.setResponse(async () => ({ ok: true, json: async () => [] }));
    tick(cx);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.getWaiting()).toEqual([]);
});
test.each(["http", "invalid", "offline"])("failed wait reads clear stale grouping (%s)", async (failure) => {
    const h = host(
        [],
        undefined,
        [],
        [{ terminal: "t2", event: "green", target: "https://github.com/acme/widgets/pull/42" }]
    );
    const cx: any = { notify: () => {}, spawn: (f: any) => void f(cx) };
    h.setResponse(async () => {
        if (failure === "offline") throw Error("offline");
        return { ok: failure !== "http", json: async () => (failure === "invalid" ? {} : []) };
    });
    h.mod.loadWaiting(cx);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.getWaiting()).toEqual([]);
});
test("slow reads do not overlap", async () => {
    const h = host([]);
    const cx: any = { notify: () => {}, spawn: (f: any) => void f(cx) };
    let finish: any;
    h.setResponse(
        () =>
            new Promise((resolve) => {
                finish = resolve;
            })
    );
    h.mod.loadWaiting(cx);
    h.mod.loadWaiting(cx);
    expect(h.requests).toHaveLength(1);
    finish({ ok: true, json: async () => [] });
    await new Promise((r) => setTimeout(r, 0));
    h.mod.loadWaiting(cx);
    expect(h.requests).toHaveLength(2);
    finish({ ok: true, json: async () => [] });
});
