import { expect, test } from "vitest";
import { noteResume, resumingNow } from "./resuming";

test("a session resumed a moment ago is resuming; after the grace, or never noted, it is not", () => {
    noteResume("cd '/w' && claude --resume 'abc-1'", 1000);
    expect([resumingNow("abc-1", 2000), resumingNow("abc-1", 1000 + 3 * 60_000), resumingNow("other", 2000)]).toEqual([true, false, false]);
});
