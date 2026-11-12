import { describe, expect, test, vi } from "vitest";
import { asTyped, DraftInPane, hasDraft, typeIntoPane, type Row } from "./typeIntoPane";

const sent = vi.hoisted(() => [] as string[]);
const screen = vi.hoisted(() => ({ lines: [] as string[] }));
vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: { ControllerInputCommand: async (_c: unknown, d: { inputdata64: string }) => void sent.push(d.inputdata64) } }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/util/util", () => ({ stringToBase64: (s: string) => s }));
// A terminal whose screen is screen.lines; "~" marks the faint cells.
vi.mock("@/store/global", () => ({
    getBlockComponentModel: () => ({
        viewModel: {
            termRef: {
                current: {
                    terminal: {
                        rows: screen.lines.length,
                        cols: 40,
                        buffer: { active: { viewportY: 0, getLine: (y: number) => ({ getCell: (x: number) => { const l = screen.lines[y]; const faint = l.startsWith("~") && x >= 2; const ch = (faint ? l.slice(1) : l)[x] ?? " "; return { getWidth: () => 1, getChars: () => ch, isDim: () => (faint ? 1 : 0) }; } }) } },
                    },
                },
            },
        },
    }),
}));

// "~" before a line: everything after its prompt is faint, as Claude draws its placeholder.
const rows = (...lines: string[]): Row[] =>
    lines.map((l) => {
        const faint = l.startsWith("~");
        return [...(faint ? l.slice(1) : l)].map((ch, x) => ({ ch, dim: faint && x >= 2 }));
    });
const RULE = "──────────";

describe("asTyped", () => {
    test("one line goes as typed, so a question's picker takes its number", () => expect(asTyped("2")).toBe("2"));
    test("several lines go as one paste, or the first line would send on its own", () => expect(asTyped("a\nb")).toBe("\x1b[200~a\nb\x1b[201~"));
});

describe("hasDraft: what you wrote in Claude's input box", () => {
    test("an empty box", () => expect(hasDraft(rows("output", RULE, "❯ ", RULE, "  status line"))).toBe(false));
    test("its faint placeholder is not yours", () => expect(hasDraft(rows(RULE, '~❯ Try "how does <filepath> work?"', RULE))).toBe(false));
    test("a half-written line", () => expect(hasDraft(rows(RULE, "❯ half written", RULE))).toBe(true));
    test("a second line of it", () => expect(hasDraft(rows(RULE, "❯ ", "  and more", RULE))).toBe(true));
    test("a ❯ in the output above, not under a rule, is no box", () => expect(hasDraft(rows("❯ ls", "file", RULE, "❯ ", RULE))).toBe(false));
    test("no box on screen (a shell)", () => expect(hasDraft(rows("$ ls", "file"))).toBe(false));
});

describe("typeIntoPane", () => {
    test("types into an empty box, Enter after", async () => {
        screen.lines = [RULE, "❯ ", RULE];
        sent.length = 0;
        await typeIntoPane("b1", "hello");
        expect(sent).toEqual(["hello", "\r"]);
    });
    test("leaves a box with your draft alone, so it isn't sent half-written", async () => {
        screen.lines = [RULE, "❯ half wri", RULE];
        sent.length = 0;
        await expect(typeIntoPane("b1", "hello")).rejects.toBeInstanceOf(DraftInPane);
        expect(sent).toEqual([]);
    });
});
