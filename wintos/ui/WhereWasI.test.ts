import { expect, test } from "vitest";
import { AWAY_FROM_SESSION_MS, isReturn } from "./WhereWasI";

test("a return is looking at a pane again after 15 minutes away; the first look is none", () => {
    expect(isReturn(undefined, 1e9)).toBe(false);
    expect(isReturn(1e9 - AWAY_FROM_SESSION_MS + 1, 1e9)).toBe(false);
    expect(isReturn(1e9 - AWAY_FROM_SESSION_MS, 1e9)).toBe(true);
});
