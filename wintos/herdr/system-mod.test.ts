import { transformSync } from "esbuild";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, test, vi } from "vitest";

function element() {
    const node: any = { children: [], attrs: {} };
    const builder: any = new Proxy(node, { get(target, key: string) {
        if (key in target) return target[key];
        if (["on_click", "on_key_down", "cursor_pointer"].includes(key)) throw Error("Status must have no actions");
        if (key === "child") return (child: any) => { target.children.push(child); return builder; };
        return (value: any) => { target.attrs[key] = value; return builder; };
    } });
    return builder;
}
const ok = (data: any) => ({ ok: true, json: async () => data });
function host(fetchReply: (...args: any[]) => Promise<any>) {
    const theme = { chrome: "chrome-token", muted: "muted-token", foreground: "foreground-token" };
    const module = { exports: {} as any };
    const fetch = vi.fn(fetchReply);
    runInNewContext(transformSync(readFileSync(`${__dirname}/mods/wintos-system/main.js`, "utf8"), { format: "cjs" }).code, {
        module, exports: module.exports, fetch,
        require: (name: string) => {
            if (name === "gpui-kit") return { View: class {}, div: element };
            if (name === "gpui-base") return { h_flex: element };
            if (name === "herdr") return { theme: () => theme };
            throw Error("Unexpected host API");
        },
    });
    const mod = new module.exports.default();
    const tasks: Promise<any>[] = [];
    const timers: { ms: number; callback: (cx: any) => void }[] = [];
    const cx = { notify: vi.fn(), spawn: (fn: any) => tasks.push(fn(cx)),
        timer: { every: (ms: number, callback: any) => timers.push({ ms, callback }) } };
    mod.init({}, cx);
    const rendered = () => {
        const root = mod.render();
        const text = (node: any): string => typeof node === "string" ? node : node.children.map(text).join("");
        return { root, text: text(root) };
    };
    return { mod, cx, fetch, timers, tasks, rendered, flush: () => Promise.all(tasks) };
}

test("renders unknowns immediately, then themed native CPU/RAM text from the protected GET path", async () => {
    const h = host(async () => ok({ cpu: 42.3, memory: { used: 12 * 1024 ** 3, total: 48 * 1024 ** 3 } }));
    expect(h.rendered().text).toBe("CPU — · RAM —");
    await h.flush();
    expect(h.fetch).toHaveBeenCalledWith("http://127.0.0.1:7732/system");
    expect(h.rendered().text).toBe("CPU 42% · RAM 12.0/48 GiB");
    expect(h.rendered().root.attrs).toMatchObject({ id: "wintos-system", bg: "chrome-token" });
    expect(h.cx.notify).toHaveBeenCalled();
});

test("refreshes every five seconds with only one request in flight", async () => {
    let finish!: (value: any) => void;
    const h = host(() => new Promise((resolve) => finish = resolve));
    expect(h.timers.map((timer) => timer.ms)).toEqual([5000]);
    h.timers[0].callback(h.cx);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    finish(ok({ cpu: 0, memory: { used: 0, total: 8 * 1024 ** 3 } }));
    await h.flush();
    expect(h.rendered().text).toBe("CPU 0% · RAM 0.0/8 GiB");
    h.fetch.mockResolvedValueOnce(ok({ cpu: 100 }));
    h.timers[0].callback(h.cx);
    await h.flush();
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(h.rendered().text).toBe("CPU 100% · RAM —");
});

test.each([
    { cpu: null, memory: null }, {}, { cpu: -1 }, { cpu: 101 }, { cpu: "42" }, { cpu: NaN },
    { cpu: Infinity }, { memory: { used: -1, total: 16 } }, { memory: { used: 17, total: 16 } },
    { memory: { used: 0, total: 0 } }, { memory: { used: 1, total: Infinity } },
    { memory: { used: "1", total: 16 } }, null,
])("invalid or absent metrics render as unknown (%#)", async (data) => {
    const h = host(async () => ok(data));
    await h.flush();
    expect(h.rendered().text).toBe("CPU — · RAM —");
});

test.each([
    async () => { throw Error("sensitive network payload"); },
    async () => ({ ok: false, json: async () => ({ error: "sensitive response" }) }),
    async () => ({ ok: true, json: async () => { throw Error("sensitive JSON payload"); } }),
])("failed refresh clears stale numbers and the next timer recovers (%#)", async (failure) => {
    const h = host(async () => ok({ cpu: 42 }));
    await h.flush();
    expect(h.rendered().text).toBe("CPU 42% · RAM —");
    h.fetch.mockImplementationOnce(failure);
    h.timers[0].callback(h.cx);
    await h.flush();
    expect(h.rendered().text).toBe("CPU — · RAM —");
    h.timers[0].callback(h.cx);
    await h.flush();
    expect(h.rendered().text).toBe("CPU 42% · RAM —");
});

test("a partial sampler failure leaves the other metric visible without exposing error text", async () => {
    const h = host(async () => ok({ cpu: 20, error: "sensitive payload" }));
    await h.flush();
    expect(h.rendered().text).toBe("CPU 20% · RAM —");
});
