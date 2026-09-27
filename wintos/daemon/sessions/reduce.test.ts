import { describe, expect, test } from "vitest";
import start from "../fixtures/session-start.json";
import prompt from "../fixtures/user-prompt-submit.json";
import stop from "../fixtures/stop.json";
import { HookEvent, reduceSession, Session } from "./reduce";

const ev = (payload: object, tabId = "tab-1", blockId = "blk-1"): HookEvent => ({ tabId, blockId, payload: payload as HookEvent["payload"] });
const run = (events: HookEvent[], t0 = 1000) =>
    events.reduce((m, e, i) => reduceSession(m, e, t0 + i * 10), new Map<string, Session>());
const only = (m: Map<string, Session>) => [...m.values()][0];

describe("reduceSession", () => {
    test("SessionStart registers an idle session on its tab and block", () => {
        expect(only(run([ev(start)]))).toMatchObject({ id: start.session_id, tabId: "tab-1", blockId: "blk-1", state: "idle" });
    });

    test("UserPromptSubmit → working, Stop → waiting since the Stop", () => {
        const m = run([ev(start), ev(prompt), ev(stop)]);
        expect(only(m)).toMatchObject({ state: "waiting", since: 1020, lastAt: 1020 });
    });

    test("a prompt after Stop clears waiting", () => {
        expect(only(run([ev(stop), ev(prompt)])).state).toBe("working");
    });

    test.each(["SubagentStop", "Notification"])("%s never changes the state", (name) => {
        const m = run([ev(stop), ev({ ...stop, hook_event_name: name })]);
        expect(only(m)).toMatchObject({ state: "waiting", since: 1000, lastAt: 1010 });
    });

    test("SessionEnd → ended", () => {
        expect(only(run([ev(prompt), ev({ ...prompt, hook_event_name: "SessionEnd" })])).state).toBe("ended");
    });

    test("an event for a session never seen (e.g. after a daemon restart) creates it", () => {
        expect(only(run([ev(stop)]))).toMatchObject({ state: "waiting", tabId: "tab-1" });
    });

    test("a resumed session moving to another block follows it", () => {
        const m = run([ev(start, "tab-1", "blk-1"), ev(start, "tab-2", "blk-9")]);
        expect(only(m)).toMatchObject({ tabId: "tab-2", blockId: "blk-9" });
    });

    test("the first prompt becomes the session's label and stays", () => {
        const m = run([ev(start), ev({ ...prompt, prompt: "Refactor the ranking into pure functions please" }), ev({ ...prompt, prompt: "second" })]);
        expect(only(m).label).toBe("Refactor the ranking in…");
    });

    test("a short first prompt is kept whole; no prompt means no label", () => {
        expect(only(run([ev({ ...prompt, prompt: "fix it" })])).label).toBe("fix it");
        expect(only(run([ev(start)])).label).toBeUndefined();
    });

    test("does not mutate its input", () => {
        const before = run([ev(prompt)]);
        const snapshot = JSON.stringify([...before]);
        reduceSession(before, ev(stop), 5000);
        expect(JSON.stringify([...before])).toBe(snapshot);
    });
});
