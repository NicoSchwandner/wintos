import { expect, test } from "vitest";
import type { Session } from "./reduce";
import { reentry } from "./reentry";

const s = (o: Partial<Session> = {}): Session => ({ id: "a", tabId: "t", blockId: "b", state: "waiting", since: 0, lastAt: 0, ...o });

test("what you asked last, what it did, and what it needs", () =>
    expect(reentry(s({ ask: { kind: "approve", text: "approve with 1 comment?", by: "session" } }), ["review #2062", "approve if good"], "Read the diff, ran /code-review high")).toEqual({
        asked: "approve if good",
        did: "Read the diff, ran /code-review high",
        needs: "Approve · approve with 1 comment?",
    }));

test("no recap: how the turn ended; parked: what it waits on; working: nothing asked", () => {
    expect(reentry(s({ state: "parked", parkedOn: "CI on #12", outcome: { text: "Pushed the fix.", at: 1 } }), [], undefined)).toEqual({ did: "Pushed the fix.", needs: "nothing: it waits on CI on #12" });
    expect(reentry(s({ state: "working" }), ["go"], undefined)).toEqual({ asked: "go" });
    expect(reentry(s(), [], undefined)).toEqual({ needs: "Your turn" });
});
