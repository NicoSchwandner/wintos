import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, test } from "vitest";
import { ProjectStore } from "./store";

let root: string;
beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "wintos-"));
});

describe("the folder belongs to its tab, whatever the file says", () => {
    const rewriteId = (dir: string, id: string) => {
        const f = join(dir, "project.md");
        writeFileSync(f, readFileSync(f, "utf8").replace(/^id: .*$/m, `id: ${id}`));
    };

    test("a session rewriting the id keeps the project on its tab, and the id is put back", () => {
        const s = new ProjectStore(root);
        const { dir } = s.setTitle("tab-1", "Invoice OCR", { manual: false });
        rewriteId(dir, "invoice-ocr");
        s.reload();
        expect(s.byTab("tab-1")?.title).toBe("Invoice OCR");
        expect(readFileSync(join(dir, "project.md"), "utf8")).toMatch(/^id: tab-1$/m);
    });

    test("the binding survives a daemon restart", () => {
        const { dir } = new ProjectStore(root).setTitle("tab-1", "Invoice OCR", { manual: false });
        rewriteId(dir, "invoice-ocr");
        expect(new ProjectStore(root).byTab("tab-1")?.title).toBe("Invoice OCR");
    });

    test("a folder the daemon never bound takes the id in its file", () => {
        const s = new ProjectStore(root);
        const { dir } = s.setTitle("tab-1", "Invoice OCR", { manual: false });
        rmSync(join(root, ".bindings.json"));
        rewriteId(dir, "tab-9");
        expect(new ProjectStore(root).byTab("tab-9")?.title).toBe("Invoice OCR");
    });
});

describe("ProjectStore", () => {
    test("setTitle creates the folder once and never renames it", () => {
        const s = new ProjectStore(root);
        const p = s.setTitle("tab-1", "Invoice OCR", { manual: false });
        expect(p.dir).toBe(join(root, "invoice-ocr"));
        expect(readFileSync(join(p.dir, "project.md"), "utf8")).toContain("title: Invoice OCR");
        s.setTitle("tab-1", "Something else", { manual: false });
        expect(readdirSync(root).filter((n) => !n.startsWith("."))).toEqual(["invoice-ocr"]);
        expect(s.byTab("tab-1")?.title).toBe("Something else");
    });

    test("a manual title locks it against Claude", () => {
        const s = new ProjectStore(root);
        s.setTitle("tab-1", "Mine", { manual: true });
        s.setTitle("tab-1", "Claude's idea", { manual: false });
        expect(s.byTab("tab-1")).toMatchObject({ title: "Mine", titleLocked: true });
    });

    test("two tabs with the same title get distinct folders", () => {
        const s = new ProjectStore(root);
        s.setTitle("a", "Same", { manual: false });
        s.setTitle("b", "Same", { manual: false });
        expect(readdirSync(root).filter((n) => !n.startsWith(".")).sort()).toEqual(["same", "same-2"]);
    });

    test("setTitle keeps the body Claude wrote", () => {
        const s = new ProjectStore(root);
        const p = s.setTitle("t", "X", { manual: false });
        writeFileSync(join(p.dir, "project.md"), readFileSync(join(p.dir, "project.md"), "utf8") + "## Goal\nkeep me\n");
        s.reload();
        s.setTitle("t", "Y", { manual: false });
        expect(readFileSync(join(p.dir, "project.md"), "utf8")).toContain("keep me");
    });

    test("an unreadable project.md is listed with its error and keeps its tab", () => {
        const s = new ProjectStore(root);
        const p = s.setTitle("t", "X", { manual: false });
        writeFileSync(join(p.dir, "project.md"), "garbage without a header");
        s.reload();
        expect(s.byTab("t")).toMatchObject({ dir: p.dir, error: "no front matter" });
    });

    test("a broken file still yields its id when the id line survived", () => {
        const s = new ProjectStore(root);
        const p = s.setTitle("t", "X", { manual: false });
        writeFileSync(join(p.dir, "project.md"), "id: t\n(front matter fences deleted)");
        const fresh = new ProjectStore(root);
        expect(fresh.byTab("t")).toMatchObject({ dir: p.dir, error: "no front matter" });
    });

    test("setTitle never overwrites an unreadable note", () => {
        const s = new ProjectStore(root);
        const p = s.setTitle("t", "X", { manual: false });
        writeFileSync(join(p.dir, "project.md"), "id: t\nClaude's half-written notes");
        s.reload();
        s.setTitle("t", "New", { manual: true });
        expect(readFileSync(join(p.dir, "project.md"), "utf8")).toBe("id: t\nClaude's half-written notes");
    });

    test("CRLF line endings parse", () => {
        const s = new ProjectStore(root);
        const p = s.setTitle("t", "X", { manual: false });
        writeFileSync(join(p.dir, "project.md"), "---\r\nid: t\r\ntitle: Windows\r\n---\r\nbody\r\n");
        s.reload();
        expect(s.byTab("t")).toMatchObject({ title: "Windows" });
    });

    test("a missing root is created, not a crash", () => {
        rmSync(root, { recursive: true });
        const s = new ProjectStore(root);
        expect(s.list()).toEqual([]);
        expect(existsSync(root)).toBe(true);
    });
});

describe("mineDiff", () => {
    test("missing or empty mine.md says so", () => {
        const s = new ProjectStore(root);
        s.setTitle("t", "X", { manual: false });
        expect(s.mineDiff("t", "s1")).toEqual({ text: "mine.md is empty" });
    });

    test("a diff appears only after a change, once", () => {
        const s = new ProjectStore(root);
        const p = s.setTitle("t", "X", { manual: false });
        writeFileSync(join(p.dir, "mine.md"), "a\nb\n");
        expect(s.mineDiff("t", "s1").diff).toBeUndefined();
        writeFileSync(join(p.dir, "mine.md"), "a\nc\n");
        expect(s.mineDiff("t", "s1")).toEqual({ text: "a\nc\n", diff: "- b\n+ c" });
        expect(s.mineDiff("t", "s1").diff).toBeUndefined();
    });

    test("every session in the project sees the change once", () => {
        const s = new ProjectStore(root);
        const p = s.setTitle("t", "X", { manual: false });
        writeFileSync(join(p.dir, "mine.md"), "a\n");
        s.mineDiff("t", "s1");
        s.mineDiff("t", "s2");
        writeFileSync(join(p.dir, "mine.md"), "b\n");
        expect(s.mineDiff("t", "s1").diff).toBe("- a\n+ b");
        expect(s.mineDiff("t", "s2").diff).toBe("- a\n+ b");
    });

    test("no project yet means no mine.md", () => {
        expect(new ProjectStore(root).mineDiff("nope", "s1")).toEqual({ text: "mine.md is empty" });
    });
});
