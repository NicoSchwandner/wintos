import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { Md } from "./Md";

const html = (text: string, opts: { inline?: boolean; links?: boolean } = {}) => renderToStaticMarkup(<Md text={text} size="rail" {...opts} />);

describe("Md", () => {
    test.each([
        ["bullets, nested", "- top\n  - nested", ["<ul", "<li", "<ul"], ["- top"]],
        ["numbered lists keep their start", "3. third\n4. fourth", ['<ol start="3"', "<li"], ["3."]],
        ["bold and italic", "**bold** and *it*", ["<strong>bold</strong>", "<em>it</em>"], ["**"]],
        ["headings, without their hashes", "## Later", [">Later</span>"], ["##"]],
        ["tables", "| a | b |\n|---|---|\n| 1 | 2 |", ["<table", "<th", ">1</td>"], ["|"]],
        ["block quotes", "> quoted", ["<blockquote", "quoted"], ["&gt;"]],
        ["images", "![chart](https://example.com/c.png)", ['<img src="https://example.com/c.png" alt="chart"'], []],
        ["code", "use `x_y`", [">x_y</span>"], ["`"]],
        ["a markdown link keeps its text", "[the PR](https://github.com/acme/api/pull/7)", ['href="https://github.com/acme/api/pull/7"', ">the PR</a>"], []],
        ["a bare url reads short, without the full stop", "see https://www.example.com/runs/42.", [">example.com/runs/42</a>."], []],
        ["task lists show boxes, not brackets", "- [ ] todo\n- [x] done", ["✓", "line-through"], ["[ ]", "[x]"]],
    ])("%s", (_, text, has, hasNot) => {
        const h = html(text);
        for (const x of has) expect(h).toContain(x);
        for (const x of hasNot) expect(h).not.toContain(x);
    });

    test("inline: no paragraph around one line", () => expect(html("one `line`", { inline: true }).startsWith("<p")).toBe(false));

    test("links: false shows the text without a link", () => expect(html("[the PR](https://x.y/1)", { links: false })).not.toContain("<a"));

    test("raw html is shown as text, never run", () => expect(html("<img src=x onerror=alert(1)>")).not.toContain("<img"));
});
