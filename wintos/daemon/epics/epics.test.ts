import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, test } from "vitest";
import { EpicStore, findEpic, parseEpicMd, serializeEpicMd, type Epic } from "./epics";

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
        const e: Epic = { id: "a", title: "A", lane: "review", steps: [{ name: "One", state: "todo" }], done: "2026-11-20", pinned: true, agent: "s-1" };
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
