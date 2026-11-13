import { transformSync } from "esbuild";
import { readFileSync } from "fs";
import { expect, test } from "vitest";
import { runInNewContext } from "vm";

function host(replies: (url: string, options?: any) => Promise<any>) {
    const effects: any[] = [];
    const module = { exports: {} as any };
    runInNewContext(
        transformSync(readFileSync(`${__dirname}/mods/wintos-search/main.js`, "utf8"), { format: "cjs" }).code,
        {
            module,
            exports: module.exports,
            fetch: replies,
            encodeURIComponent,
            require: (name: string) =>
                name === "gpui-kit"
                    ? { View: class {} }
                    : name === "gpui-base"
                      ? {}
                      : {
                            props: () => ({ overlay: "popup" }),
                            closeOverlay: (id: string) => effects.push(id),
                        },
        }
    );
    const mod = new module.exports.default();
    Object.assign(mod, { rows: [], at: 0, query: "", sequence: 0 });
    const pending: Promise<void>[] = [];
    const cx = { notify: () => {}, spawn: (f: any) => pending.push(f(cx)) };
    return { mod, effects, cx, pending };
}
const ok = (rows: any) => ({ ok: true, json: async () => rows });
test("loads session matches from the companion and resets selection", async () => {
    const h = host(async (url) => {
        expect(url).toContain("/search?q=%2324");
        return ok([{ id: "s", name: "Example", prs: ["https://github.com/acme/api/pull/24"] }]);
    });
    h.mod.query = "#24";
    h.mod.at = 4;
    h.mod.load(h.cx);
    await Promise.all(h.pending);
    expect(h.mod.rows.map((r: any) => r.id)).toEqual(["s"]);
    expect(h.mod.at).toBe(0);
});
test("an older search response cannot replace a newer query", async () => {
    let finish: (v: any) => void;
    const old = new Promise((r) => (finish = r));
    const h = host(async (url) => (url.endsWith("first") ? old : ok([{ id: "new" }])));
    h.mod.query = "first";
    h.mod.load(h.cx);
    h.mod.query = "second";
    h.mod.load(h.cx);
    await h.pending[1];
    finish!(ok([{ id: "old" }]));
    await h.pending[0];
    expect(h.mod.rows.map((r: any) => r.id)).toEqual(["new"]);
});
test("opens the chosen conversation and closes only on success", async () => {
    const h = host(async (_url, options) => {
        expect(JSON.parse(options.body)).toEqual({ id: "chosen" });
        return ok({});
    });
    await h.mod.go({ id: "chosen" }, h.cx);
    expect(h.effects).toEqual(["popup"]);
});
test("an unsafe resume refusal is shown and the picker stays open", async () => {
    const h = host(async () => ({
        ok: false,
        json: async () => ({ error: "Conversation is still running in WintOS" }),
    }));
    await h.mod.go({ id: "chosen" }, h.cx);
    expect(h.effects).toEqual([]);
    expect(h.mod.note).toContain("still running");
});
test("an unavailable service gives a visible error and stays open", async () => {
    const h = host(async () => {
        throw Error("offline");
    });
    h.mod.load(h.cx);
    await Promise.all(h.pending);
    expect(h.mod.note).toContain("companion");
    expect(h.effects).toEqual([]);
});
