import { describe, expect, test } from "vitest";
import { parseProjectMd, serializeProjectMd } from "./parse";
import { slugify } from "./slug";

const doc = `---
id: tab-1
title: Invoice OCR fallback
title_locked: true
next: Approve the schema migration plan
pr: api#101, acme/ledger#4821
---
## Goal
Keep ingestion above 99%.
`;

describe("parseProjectMd", () => {
    test("reads front matter and body", () => {
        const r = parseProjectMd(doc);
        expect(r).toEqual({
            meta: {
                id: "tab-1",
                title: "Invoice OCR fallback",
                titleLocked: true,
                next: "Approve the schema migration plan",
                pr: ["api#101", "acme/ledger#4821"],
            },
            body: "## Goal\nKeep ingestion above 99%.\n",
        });
    });

    test("missing front matter is an error, not an empty project", () => {
        expect(parseProjectMd("## Goal\nno header")).toEqual({ error: "no front matter" });
    });

    test("front matter without id is an error", () => {
        expect(parseProjectMd("---\ntitle: x\n---\n")).toEqual({ error: "front matter has no id" });
    });

    test("optional keys default", () => {
        const r = parseProjectMd("---\nid: t\n---\n");
        expect(r).toEqual({ meta: { id: "t", titleLocked: false, pr: [] }, body: "" });
    });

    test("serialize round-trips", () => {
        const r = parseProjectMd(doc);
        if ("error" in r) throw new Error(r.error);
        expect(parseProjectMd(serializeProjectMd(r.meta, r.body))).toEqual(r);
    });
});

describe("slugify", () => {
    test("lowercases and dashes", () => expect(slugify("Invoice OCR: fallback!", new Set())).toBe("invoice-ocr-fallback"));
    test("clash gets a suffix", () => expect(slugify("A b", new Set(["a-b", "a-b-2"]))).toBe("a-b-3"));
    test("nothing sluggable falls back", () => expect(slugify("✳ ✳", new Set())).toBe("project"));
});
