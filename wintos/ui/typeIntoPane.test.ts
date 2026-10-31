import { describe, expect, test, vi } from "vitest";
import { asTyped } from "./typeIntoPane";

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: {} }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/util/util", () => ({ stringToBase64: (s: string) => s }));

describe("asTyped", () => {
    test("one line goes as typed, so a question's picker takes its number", () => expect(asTyped("2")).toBe("2"));
    test("several lines go as one paste, or the first line would send on its own", () => expect(asTyped("a\nb")).toBe("\x1b[200~a\nb\x1b[201~"));
});
