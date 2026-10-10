import { describe, expect, test } from "vitest";
import start from "../fixtures/session-start.json";
import prompt from "../fixtures/user-prompt-submit.json";
import stop from "../fixtures/stop.json";
import { finishSession, HookEvent, parkSession, reduceSession, restoreSessions, Session, setLane, setStatus, setStep } from "./reduce";

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

describe("parkSession (`wintos wait`)", () => {
    const park = (m: Map<string, Session>, reason = "CI on #1479") => parkSession(m, "blk-1", reason, 5000);

    test("a turn that already ended waiting on you parks at once (you parked it: nothing for you)", () => {
        const m = run([ev(start), ev(prompt), ev(stop)]);
        expect(only(park(m, "parked by you"))).toMatchObject({ state: "parked", parkedOn: "parked by you", since: 5000 });
    });

    test("a turn that ends after `wintos wait` is parked, not waiting on the developer", () => {
        const m = run([ev(start), ev(prompt)]);
        const s = only(reduceSession(park(m), ev(stop), 6000));
        expect(s).toMatchObject({ state: "parked", parkedOn: "CI on #1479", since: 6000 });
    });

    test("the next turn that ends without it waits on the developer again", () => {
        const m = run([ev(start), ev(prompt)]);
        const parked = reduceSession(park(m), ev(stop), 6000);
        const s = only(reduceSession(parked, ev(stop), 7000)); // resumed by a background notification
        expect(s).toMatchObject({ state: "waiting" });
        expect(s.parkedOn).toBeUndefined();
    });

    test("the developer's next prompt clears it", () => {
        const m = reduceSession(park(run([ev(start), ev(prompt)])), ev(stop), 6000);
        const s = only(reduceSession(m, ev(prompt), 7000));
        expect(s.state).toBe("working");
        expect(s.parkedOn).toBeUndefined();
    });

    test("parks the block's live session, and nothing when the block has none", () => {
        const m = run([ev(start)]);
        expect(only(park(m)).parkPending).toBe(true);
        expect(parkSession(m, "other-block", "x", 5000)).toBe(m);
    });
});

describe("restoreSessions (after a WintOS restart)", () => {
    const s = (id: string, state: Session["state"], blockId = "blk-1"): Session => ({ id, tabId: "tab-1", blockId, state, since: 1, lastAt: 1 });

    test("keeps what was true at quit, marked not started; a cut-off turn is idle; ended ones go", () => {
        const m = restoreSessions([s("a", "waiting"), s("b", "working", "blk-2"), s("c", "parked", "blk-3"), s("d", "ended", "blk-4")]);
        expect([...m.values()].map((x) => [x.id, x.state, x.restored])).toEqual([
            ["a", "waiting", true],
            ["b", "idle", true],
            ["c", "parked", true],
        ]);
    });

    test("the resumed session's first event takes over its block, even under a new id", () => {
        const m = reduceSession(restoreSessions([s("old", "waiting")]), ev({ hook_event_name: "SessionStart", session_id: "new" }), 5);
        expect([...m.values()].map((x) => [x.id, x.restored])).toEqual([["new", undefined]]);
    });

    test("under the same id it keeps its state and loses the mark", () => {
        const m = reduceSession(restoreSessions([s("a", "waiting")]), ev({ hook_event_name: "SessionStart", session_id: "a" }), 5);
        expect(only(m)).toMatchObject({ id: "a", state: "waiting" });
        expect(only(m).restored).toBeUndefined();
    });
});

describe("finishSession (`wintos done`)", () => {
    test("a turn that ends after `wintos done` is done, not waiting on the developer", () => {
        const m = run([ev(prompt)]);
        expect(only(reduceSession(finishSession(m, "blk-1", 5000), ev(stop), 6000))).toMatchObject({ state: "done", since: 6000 });
    });

    test("the next prompt starts over", () => {
        const done = reduceSession(finishSession(run([ev(prompt)]), "blk-1", 5000), ev(stop), 6000);
        const s = only(reduceSession(reduceSession(done, ev(prompt), 7000), ev(stop), 8000));
        expect(s).toMatchObject({ state: "waiting" });
    });

    test("done and wait in one turn: the later call wins", () => {
        const m = run([ev(prompt)]);
        expect(only(reduceSession(parkSession(finishSession(m, "blk-1", 5000), "blk-1", "CI", 5100), ev(stop), 6000)).state).toBe("parked");
        expect(only(reduceSession(finishSession(parkSession(m, "blk-1", "CI", 5000), "blk-1", 5100), ev(stop), 6000)).state).toBe("done");
    });
});

describe("turnEndedAt", () => {
    test("every ended turn records when, so the UI can tell a new reply from one you saw", () => {
        const m = run([ev(prompt), ev(stop)]);
        expect(only(m).turnEndedAt).toBe(1010);
        expect(only(reduceSession(m, ev(prompt), 2000)).turnEndedAt).toBe(1010);
    });
});

describe("a session's PRs (PostToolUse on gh pr)", () => {
    const tool = (prs: string[]) => ({ ...stop, hook_event_name: "PostToolUse", prs });
    const A = "https://github.com/o/r/pull/1", B = "https://github.com/o/r/pull/2";
    test("collects the PRs its commands touched, once each, newest last", () =>
        expect(only(run([ev(prompt), ev(tool([A])), ev(tool([B, A]))])).prs).toEqual([B, A]));
    test("a listing of many PRs claims none", () =>
        expect(only(run([ev(prompt), ev(tool([A, B, "https://github.com/o/r/pull/3", "https://github.com/o/r/pull/4"]))])).prs).toBeUndefined());
    test("a tool call never changes the state", () => expect(only(run([ev(stop), ev(tool([A]))])).state).toBe("waiting"));
    test("the PRs outlive the turn", () => expect(only(run([ev(tool([A])), ev(stop), ev(prompt)])).prs).toEqual([A]));
});

describe("setStatus (`wintos status`)", () => {
    const m = run([ev(prompt)]);
    test("sets the block's live session's line, with when", () =>
        expect(only(setStatus(m, "blk-1", "Walking the test plan", 5000)).status).toEqual({ text: "Walking the test plan", at: 5000 }));
    test("it outlives turns", () => expect(only(reduceSession(setStatus(m, "blk-1", "x", 5000), ev(stop), 6000)).status?.text).toBe("x"));
    test("another block's session is untouched", () => expect(setStatus(m, "other", "x", 5000)).toBe(m));
});

describe("a session's lane (`wintos lane`, `wintos step`)", () => {
    const m = setLane(run([ev(prompt)]), "blk-1", "feature", ["Design", "Spec", "?Approve spec", "Build"]);
    test("starts at its first step", () => expect(only(m).lane).toEqual({ name: "feature", steps: ["Design", "Spec", "?Approve spec", "Build"], at: 0 }));
    test("a step is found by name, any case, without its ?, or by its start", () => {
        expect(only(setStep(m, "blk-1", "approve SPEC")!).lane?.at).toBe(2);
        expect(only(setStep(m, "blk-1", "Bui", "slice 2 of 3")!).lane).toMatchObject({ at: 3, note: "slice 2 of 3" });
    });
    test("an unknown step is refused", () => expect(setStep(m, "blk-1", "Deploy")).toBeUndefined());
    test("moving on drops the old step's note", () => expect(only(setStep(setStep(m, "blk-1", "Build", "x")!, "blk-1", "Spec")!).lane?.note).toBeUndefined());
    test("it outlives turns", () => expect(only(reduceSession(m, ev(stop), 6000)).lane?.name).toBe("feature"));
});
