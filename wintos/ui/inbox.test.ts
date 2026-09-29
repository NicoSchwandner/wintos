import { describe, expect, test } from "vitest";
import { inboxHandoff, readInboxHandoff } from "./inbox";

describe("the Inbox handoff", () => {
    test("carries which list to show", () => expect(readInboxHandoff(inboxHandoff("oncall", 1000), 2000)).toBe("oncall"));

    test("a stale one (the Inbox never took it) is ignored", () => expect(readInboxHandoff(inboxHandoff("prs", 1000), 1000 + 60_000)).toBeUndefined());

    test("nothing, or anything malformed, is nothing", () => {
        expect(readInboxHandoff(null, 0)).toBeUndefined();
        expect(readInboxHandoff("{", 0)).toBeUndefined();
        expect(readInboxHandoff(JSON.stringify({ list: "bogus", at: 0 }), 0)).toBeUndefined();
    });
});
