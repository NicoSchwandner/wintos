import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, test } from "vitest";
import { ProjectStore } from "./store";

let root: string;
beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "wintos-"));
});

describe("ProjectStore", () => {
    test("setTitle creates the folder once and never renames it", () => {
        const s = new ProjectStore(root);
        const p = s.setTitle("tab-1", "Invoice OCR", { manual: false });
        expect(p.dir).toBe(join(root, "invoice-ocr"));
        expect(readFileSync(join(p.dir, "project.md"), "utf8")).toContain("title: Invoice OCR");
        s.setTitle("tab-1", "Something else", { manual: false });
        expect(readdirSync(root)).toEqual(["invoice-ocr"]);
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
        expect(readdirSync(root).sort()).toEqual(["same", "same-2"]);
    });

    test("setTitle keeps the body Claude wrote", () => {
        const s = new ProjectStore(root);
        const p = s.setTitle("t", "X", { manual: false });
        writeFileSync(join(p.dir, "project.md"), readFileSync(join(p.dir, "project.md"), "utf8") + "## Goal\nkeep me\n");
        s.reload();
        s.setTitle("t", "Y", { manual: false });
        expect(readFileSync(join(p.dir, "project.md"), "utf8")).toContain("keep me");
    });

    test("an unreadable project.md is listed with its error", () => {
        const s = new ProjectStore(root);
        const p = s.setTitle("t", "X", { manual: false });
        writeFileSync(join(p.dir, "project.md"), "garbage");
        s.reload();
        expect(s.list()).toEqual([expect.objectContaining({ dir: p.dir, error: "no front matter" })]);
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
        expect(s.mineDiff("t")).toEqual({ text: "mine.md is empty" });
    });

    test("a diff appears only after a change, once", () => {
        const s = new ProjectStore(root);
        const p = s.setTitle("t", "X", { manual: false });
        writeFileSync(join(p.dir, "mine.md"), "a\nb\n");
        expect(s.mineDiff("t").diff).toBeUndefined();
        writeFileSync(join(p.dir, "mine.md"), "a\nc\n");
        expect(s.mineDiff("t")).toEqual({ text: "a\nc\n", diff: "- b\n+ c" });
        expect(s.mineDiff("t").diff).toBeUndefined();
    });

    test("no project yet means no mine.md", () => {
        expect(new ProjectStore(root).mineDiff("nope")).toEqual({ text: "mine.md is empty" });
    });
});
