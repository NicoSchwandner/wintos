import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, test } from "vitest";
import { EpicStore, findEpic, parseEpicMd, serializeEpicMd, type Epic } from "./epics";
import { moveEpic, orderEpics } from "./order";

describe("epic.md", () => {
    test("reads the front matter and keeps the body", () => {
        const p = parseEpicMd("---\nid: route-do\ntitle: Route documents\nshort: Route\nglyph: route\ncolor: teal\nlane: support\nsteps: [x] Intake | [ ] Cutover\n---\nGoal: all of them.\n");
        expect(p).toEqual({
            epic: { id: "route-do", title: "Route documents", short: "Route", glyph: "route", color: "teal", lane: "support", steps: [{ name: "Intake", state: "done" }, { name: "Cutover", state: "todo" }] },
            body: "Goal: all of them.\n",
        });
    });
    test("an epic needs an id and a title", () => {
        expect(parseEpicMd("---\nid: x\n---\n")).toBeUndefined();
        expect(parseEpicMd("no front matter")).toBeUndefined();
    });
    test("written back as it was read", () => {
        const e: Epic = { id: "a", title: "A", lane: "review", steps: [{ name: "One", state: "todo" }], done: "2026-11-20", pinned: true, agent: "s-1", links: { One: ["s-2"] } };
        expect(parseEpicMd(serializeEpicMd(e, "body\n"))).toEqual({ epic: e, body: "body\n" });
    });
});

describe("findEpic", () => {
    const epics: Epic[] = [
        { id: "route-do", title: "Route all incoming documents", short: "Route DO", steps: [] },
        { id: "reviews", title: "Reviews", steps: [] },
    ];
    test("by id, title or short name, any case", () => {
        expect(findEpic(epics, "route-do")?.id).toBe("route-do");
        expect(findEpic(epics, "reviews")?.id).toBe("reviews");
        expect(findEpic(epics, "route do")?.id).toBe("route-do");
    });
    test("else the first that starts with it", () => expect(findEpic(epics, "rev")?.id).toBe("reviews"));
    test("nothing that matches: none", () => expect(findEpic(epics, "coder")).toBeUndefined());
});

describe("EpicStore", () => {
    const fresh = () => new EpicStore(mkdtempSync(join(tmpdir(), "epics-")));

    test("creates an epic as a folder named after its title", () => {
        const s = fresh();
        const e = s.create("Route all documents", { lane: "support" });
        expect(e.id).toBe("route-all-documents");
        expect(readFileSync(join(e.dir, "epic.md"), "utf8")).toContain("lane: support");
        expect(s.list().map((x) => x.id)).toEqual(["route-all-documents"]);
    });
    test("two epics with the same title get their own folders", () => {
        const s = fresh();
        s.create("Reviews");
        expect(s.create("Reviews").id).toBe("reviews-2");
    });
    test("update changes the front matter and keeps the body", () => {
        const s = fresh();
        const e = s.create("A");
        writeFileSync(join(e.dir, "epic.md"), readFileSync(join(e.dir, "epic.md"), "utf8") + "notes\n");
        s.reload();
        s.update(e.id, (x) => ({ ...x, done: "2026-11-04" }));
        expect(s.byId(e.id)).toMatchObject({ done: "2026-11-04", body: "notes\n" });
        expect(s.update("missing", (x) => x)).toBeUndefined();
    });
    test("an update keeps a plan written into epic.md since it was read", () => {
        const s = fresh();
        const e = s.create("A");
        writeFileSync(join(e.dir, "epic.md"), readFileSync(join(e.dir, "epic.md"), "utf8") + "## Goal\nShip it.\n");
        s.update(e.id, (x) => ({ ...x, pinned: true }));
        expect(readFileSync(join(e.dir, "epic.md"), "utf8")).toContain("## Goal\nShip it.");
        expect(s.byId(e.id)?.pinned).toBe(true);
    });
    test("a folder without epic.md, or a hidden one, is not an epic", () => {
        const root = mkdtempSync(join(tmpdir(), "epics-"));
        mkdirSync(join(root, "stray"));
        mkdirSync(join(root, ".cache"));
        expect(new EpicStore(root).list()).toEqual([]);
    });
    test("mine.md is saved unless it changed since the edit began", () => {
        const s = fresh();
        const e = s.create("A");
        expect(s.mine(e.id)).toEqual({ text: "", mtime: 0 });
        expect(s.saveMine(e.id, "one")).toBe("ok");
        const { mtime } = s.mine(e.id)!;
        expect(s.saveMine(e.id, "two", mtime - 1)).toBe("conflict");
        expect(s.saveMine(e.id, "two", mtime)).toBe("ok");
        expect(s.mine(e.id)!.text).toBe("two");
        expect(s.saveMine("missing", "x")).toBe("no epic");
    });
});

describe("the order of the epics", () => {
    const e = (id: string, more: Partial<Epic> = {}) => ({ id, title: id, steps: [], ...more });
    test("pinned first, then your order, then by name", () =>
        expect(orderEpics([e("zeta"), e("Alpha"), e("mid", { rank: 1 }), e("top", { rank: 0 }), e("pin", { pinned: true })]).map((x) => x.id)).toEqual(["pin", "top", "mid", "Alpha", "zeta"]));
    test("a move swaps with the neighbour and ranks them all; never past the pinned ones or the ends", () => {
        const open = [e("a"), e("b"), e("c"), e("p", { pinned: true })];
        expect([...moveEpic(open, "c", -1)!]).toEqual([["p", 0], ["a", 1], ["c", 2], ["b", 3]]);
        expect(moveEpic(open, "a", -1)).toBeUndefined();
        expect(moveEpic(open, "c", 1)).toBeUndefined();
    });
    test("rank survives the front matter", () => expect(parseEpicMd(serializeEpicMd(e("x", { rank: 3 }), ""))?.epic.rank).toBe(3));
});
