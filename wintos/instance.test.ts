import { describe, expect, test } from "vitest";
import { wintosInstance } from "./instance";

describe("wintosInstance", () => {
    test("the everyday instance: port 7730, no label", () => expect(wintosInstance({})).toEqual({ port: 7730, label: "" }));
    test("a second instance runs its own daemon and says what it is", () =>
        expect(wintosInstance({ WINTOS_PORT: "7731", WINTOS_INSTANCE: "dev" })).toEqual({ port: 7731, label: "dev" }));
    test("a port that isn't one falls back to the default", () => expect(wintosInstance({ WINTOS_PORT: "x" }).port).toBe(7730));
});
