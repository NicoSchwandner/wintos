import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { expect, test, vi } from "vitest";
import { readJson, writeJsonAtomic } from "./persist";

test("a written file reads back; no temporary file is left", () => {
    const f = join(mkdtempSync(join(tmpdir(), "persist-")), "x.json");
    writeJsonAtomic(f, { a: 1 });
    expect([readJson(f, {}), existsSync(`${f}.tmp`)]).toEqual([{ a: 1 }, false]);
});

test("a torn file is kept as .corrupt instead of silently read as empty", () => {
    const f = join(mkdtempSync(join(tmpdir(), "persist-")), "x.json");
    writeFileSync(f, '{"a": 1, "b"');
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(readJson(f, { empty: true })).toEqual({ empty: true });
    spy.mockRestore();
    expect(readFileSync(`${f}.corrupt`, "utf8")).toBe('{"a": 1, "b"');
});
