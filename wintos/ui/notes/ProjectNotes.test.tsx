import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ProjectNotes } from "./ProjectNotes";

const md = (decisions: number, done: number, todo: number) =>
    ["## Decisions", ...Array.from({ length: decisions }, (_, i) => `- decision ${i + 1}`), "## Built", ...Array.from({ length: done }, (_, i) => `- [x] done ${i + 1}`), ...Array.from({ length: todo }, (_, i) => `- [ ] todo ${i + 1}`)].join("\n");
const html = (text: string) => renderToStaticMarkup(<ProjectNotes md={text} size="rail" />);

describe("ProjectNotes long lists", () => {
    test("past 4 decisions the later ones wait behind Show more", () => {
        const h = html(md(6, 0, 1));
        expect([h.includes("decision 4"), h.includes("decision 5"), h.includes("Show 2 more")]).toEqual([true, false, true]);
    });

    test("4 decisions show whole, with no button", () => expect(html(md(4, 0, 1)).includes("more")).toBe(false));

    test("past 4 Built items only the unticked show, with Show checked", () => {
        const h = html(md(1, 4, 1));
        expect([h.includes("done 1"), h.includes("todo 1"), h.includes("Show 4 checked")]).toEqual([false, true, true]);
    });

    test("4 Built items show whole, ticked ones too", () => expect(html(md(1, 3, 1)).includes("done 1")).toBe(true));
});
