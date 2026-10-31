import { describe, expect, test } from "vitest";
import start from "../fixtures/session-start.json";
import prompt from "../fixtures/user-prompt-submit.json";
import stop from "../fixtures/stop.json";
import { acceptSuggestedName, askSession, attachSession, readTurn, endSessions, finishSession, nameSession, renameSession, titleSession, HookEvent, parkSession, unparkSession, reduceSession, restoreSessions, Session, setLane, setStatus, setStep, setTodo, tickTodo, liveSessionsIn } from "./reduce";

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

    test("a Stop keeps the reply's first line of prose as the outcome; a turn with no text keeps the last", () => {
        const said = (text: string) => ev({ ...stop, last_assistant_message: text });
        expect(only(run([ev(prompt), said("## Done\n\n**Fixed** the `walk` from a page.\nMore below.")])).outcome).toEqual({ text: "Fixed the walk from a page.", at: 1010 });
        expect(only(run([ev(prompt), said("Shipped."), ev(prompt), said("  ")])).outcome?.text).toBe("Shipped.");
    });

    test("a prompt after Stop clears waiting", () => {
        expect(only(run([ev(stop), ev(prompt)])).state).toBe("working");
    });

    test.each(["SubagentStop", "Notification"])("%s never changes the state", (name) => {
        const m = run([ev(stop), ev({ ...stop, hook_event_name: name })]);
        expect(only(m)).toMatchObject({ state: "waiting", since: 1000, lastAt: 1010 });
    });

    test("a subagent counts from its start to its stop, whatever the turn does meanwhile", () => {
        const sub = (name: string, agent_id: string) => ev({ ...stop, hook_event_name: name, agent_id });
        let m = run([ev(prompt), sub("SubagentStart", "a1"), sub("SubagentStart", "a2"), ev(stop)]);
        expect(only(m)).toMatchObject({ state: "waiting", subagents: { a1: 1010, a2: 1020 } });
        m = reduceSession(m, sub("SubagentStop", "a1"), 2000);
        expect(only(m).subagents).toEqual({ a2: 1020 });
        m = reduceSession(m, sub("SubagentStop", "a2"), 2010);
        expect(only(m).subagents).toBeUndefined();
        expect(only(reduceSession(run([ev(prompt), sub("SubagentStart", "a1")]), ev({ ...prompt, hook_event_name: "SessionEnd" }), 3000)).subagents).toBeUndefined();
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

describe("unparkSession (⌘Z after a park)", () => {
    test("a parked turn waits on you again, its reason gone", () => {
        const m = unparkSession(parkSession(run([ev(stop)]), "blk-1", "CI", 5000), stop.session_id, 6000);
        expect(only(m)).toMatchObject({ state: "waiting", since: 6000 });
        expect(only(m).parkedOn).toBeUndefined();
    });

    test("a park still pending (the turn runs on) is dropped, and anything else is left alone", () => {
        const working = run([ev(prompt)]);
        const back = only(unparkSession(parkSession(working, "blk-1", "CI", 5000), prompt.session_id, 6000));
        expect([back.state, back.parkPending, back.parkedOn]).toEqual(["working", undefined, undefined]);
        expect(unparkSession(working, prompt.session_id, 6000)).toBe(working);
        expect(unparkSession(working, "nobody", 6000)).toBe(working);
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

describe("a pane switched to another session", () => {
    const p = (id: string, name: string, resume?: string) => ev({ hook_event_name: name, session_id: id, ...(resume ? { resume } : {}) });

    test.each(["UserPromptSubmit", "SessionStart"])("the pane's session (%s with a resume command) puts the one it ran before out", (name) => {
        const m = run([p("fork", "UserPromptSubmit", "r-fork"), p("fork", "Stop"), p("main", name, "r-main")]);
        expect([...m.keys()]).toEqual(["main"]);
    });

    test("a background session (no resume command) stays beside it, and its events put nothing out", () => {
        expect([...run([p("bg", "UserPromptSubmit"), p("main", "UserPromptSubmit", "r-main"), p("bg", "UserPromptSubmit")]).keys()].sort()).toEqual(["bg", "main"]);
    });

    test("other events of the pane's session put nothing out, nor does an ended one count", () => {
        expect([...run([p("a", "UserPromptSubmit", "r-a"), p("b", "UserPromptSubmit"), p("b", "Stop", "r-b")]).keys()].sort()).toEqual(["a", "b"]);
        expect(run([p("a", "UserPromptSubmit", "r-a"), p("a", "SessionEnd"), p("b", "UserPromptSubmit", "r-b")]).get("a")?.state).toBe("ended");
    });
});

describe("a question mid-turn (AskUserQuestion, ExitPlanMode)", () => {
    const tool = (name: string, tool_name: string) => ev({ hook_event_name: name, session_id: prompt.session_id, tool_name });
    test.each(["AskUserQuestion", "ExitPlanMode"])("%s waits on you until you answer, then the turn runs on", (t) => {
        const m = run([ev(prompt), tool("PreToolUse", t)]);
        expect(only(m)).toMatchObject({ state: "waiting", since: 1010 });
        expect(only(run([ev(prompt), tool("PreToolUse", t), tool("PostToolUse", t)]))).toMatchObject({ state: "working", ask: undefined });
    });

    test("a question asks for an answer, a plan for an approval", () => {
        expect([only(run([ev(prompt), tool("PreToolUse", "AskUserQuestion")])).ask, only(run([ev(prompt), tool("PreToolUse", "ExitPlanMode")])).ask]).toEqual([
            { kind: "answer", by: "tool" },
            { kind: "approve", by: "tool" },
        ]);
    });

    test("the question's text and options, as the hook passes them, go on the ask for the batch card", () => {
        const q = ev({ hook_event_name: "PreToolUse", session_id: prompt.session_id, tool_name: "AskUserQuestion", question: { text: "Which way?", options: [{ label: "Fast", then: "ships today" }, { label: "Safe", then: "" }, { label: "" }] } });
        expect(only(run([ev(prompt), q])).ask).toEqual({ kind: "answer", by: "tool", text: "Which way?", options: [{ label: "Fast", then: "ships today" }, { label: "Safe" }] });
    });

    test("any other tool changes nothing", () => {
        expect(only(run([ev(prompt), tool("PreToolUse", "Bash"), tool("PostToolUse", "Bash")])).state).toBe("working");
    });
});

describe("a session's name", () => {
    const live = () => run([ev(prompt)]);
    const id = prompt.session_id;

    test("the session proposes it; it stands unless you rename it", () => {
        expect(only(nameSession(live(), "blk-1", "Retention backfill: review fixes", 5000)).name).toEqual({ text: "Retention backfill: review fixes", by: "session", at: 5000 });
    });

    test("your name sticks: the session's next one is only a suggestion, which you can take", () => {
        const yours = renameSession(live(), id, "My name", 5000);
        const suggested = nameSession(yours, "blk-1", "Its name", 6000);
        expect(only(suggested).name).toEqual({ text: "My name", by: "you", at: 5000, suggested: "Its name" });
        expect(only(acceptSuggestedName(suggested, id, 7000)).name).toEqual({ text: "Its name", by: "you", at: 7000 });
    });

    test("a model's name only fills in where nobody named the session", () => {
        expect(only(titleSession(live(), id, "Model name", 5000)).name).toEqual({ text: "Model name", by: "model", at: 5000 });
        expect(only(titleSession(nameSession(live(), "blk-1", "Own", 5000), id, "Model name", 6000)).name?.text).toBe("Own");
        expect(only(titleSession(titleSession(live(), id, "First", 5000), id, "Second", 6000)).name?.text).toBe("Second");
    });

    test("a first prompt that is a paste, an image or a link names nothing", () => {
        for (const p of ['"""\n<pasted_content id="1">x', "[Image #1] look", "https://github.com/o/r/pull/1", "❯ fix the parser please"])
            expect(only(run([ev({ ...prompt, prompt: p })])).label).toBe(p.startsWith("❯") ? "fix the parser please" : undefined);
    });
});

describe("SessionEnd", () => {
    test("quitting WintOS (reason other) ends nothing: the session keeps its state and PRs for the restart", () => {
        const withPrs = new Map([[prompt.session_id, { ...only(run([ev(prompt)])), prs: ["https://github.com/o/r/pull/1"] }]]);
        const m = [ev(stop), ev({ ...stop, hook_event_name: "SessionEnd", reason: "other" })].reduce((acc, e, i) => reduceSession(acc, e, 2000 + i), withPrs);
        expect(only(m)).toMatchObject({ state: "waiting", prs: ["https://github.com/o/r/pull/1"] });
    });

    test.each(["prompt_input_exit", "logout", "clear"])("a deliberate end (%s) ends it", (reason) => {
        expect(only(run([ev(prompt), ev({ ...stop, hook_event_name: "SessionEnd", reason })])).state).toBe("ended");
    });
});

describe("endSessions (closed from WintOS: ⌘W, ⇧⌘W)", () => {
    test("ends the named ones only", () => {
        const m = endSessions(run([ev(prompt), ev({ ...prompt, session_id: "other" })]), [prompt.session_id], 9);
        expect([m.get(prompt.session_id)?.state, m.get("other")?.state]).toEqual(["ended", "working"]);
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

    test("a restart stopped every subagent: none comes back", () =>
        expect(restoreSessions([{ ...s("a", "waiting"), subagents: { x: 1 } }]).get("a")?.subagents).toBeUndefined());

    test("given the time, one not seen for two weeks is gone: a pane closed some other way leaves no session for good", () => {
        const DAY = 86_400_000;
        const m = restoreSessions([{ ...s("old", "waiting"), lastAt: 0 }, { ...s("new", "waiting", "blk-2"), lastAt: 13 * DAY }], 15 * DAY);
        expect([...m.keys()]).toEqual(["new"]);
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

describe("askSession (`wintos ask`)", () => {
    test("the turn's Stop waits on the developer for what it asked; the next prompt clears it", () => {
        const asked = reduceSession(askSession(run([ev(prompt)]), "blk-1", "decide", "which band colour", 5000), ev(stop), 6000);
        expect(only(asked)).toMatchObject({ state: "waiting", ask: { kind: "decide", text: "which band colour", by: "session" } });
        expect(only(reduceSession(asked, ev(prompt), 7000)).ask).toBeUndefined();
    });

    test("ask, wait and done in one turn: the later call wins", () => {
        const m = run([ev(prompt)]);
        expect(only(reduceSession(finishSession(askSession(m, "blk-1", "answer", undefined, 5000), "blk-1", 5100), ev(stop), 6000))).toMatchObject({ state: "done", ask: undefined });
        expect(only(reduceSession(askSession(parkSession(m, "blk-1", "CI", 5000), "blk-1", "answer", undefined, 5100), ev(stop), 6000))).toMatchObject({ state: "waiting", ask: { kind: "answer" } });
    });

    test("a Stop without one has no ask yet", () => {
        expect(only(run([ev(prompt), ev(stop)])).ask).toBeUndefined();
    });
});

describe("readTurn (the daemon's reading of a turn that said nothing)", () => {
    const ended = run([ev(prompt), ev(stop)]);
    const turnAt = only(ended).turnEndedAt!;
    test("an ask is kept; a reply that only reports is done", () => {
        expect(only(readTurn(ended, only(ended).id, turnAt, { kind: "answer", text: "ship it?", by: "model" })).ask).toEqual({ kind: "answer", text: "ship it?", by: "model" });
        expect(only(readTurn(ended, only(ended).id, turnAt, "done")).state).toBe("done");
    });

    test("a later turn, or an ask the session gave itself, makes it moot", () => {
        expect(readTurn(ended, only(ended).id, turnAt - 1, "done")).toBe(ended);
        const asked = reduceSession(askSession(run([ev(prompt)]), "blk-1", "decide", undefined, 5000), ev(stop), 6000);
        expect(readTurn(asked, only(asked).id, 6000, "done")).toBe(asked);
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

describe("a session's PRs", () => {
    const tool = (prs: string[]) => ({ ...stop, hook_event_name: "PostToolUse", prs });
    test("a tool call never changes the state", () => expect(only(run([ev(stop), ev(tool(["https://github.com/o/r/pull/1"]))])).state).toBe("waiting"));
    test("the PRs (who owns which is daemon/prs/owners.ts) outlive the turn", () => {
        const withPrs = new Map([[prompt.session_id, { ...only(run([ev(prompt)])), prs: ["u1"], touched: ["u2"] }]]);
        const m = [ev(stop), ev(prompt)].reduce((acc, e, i) => reduceSession(acc, e, 2000 + i), withPrs);
        expect([only(m).prs, only(m).touched]).toEqual([["u1"], ["u2"]]);
    });
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

describe("a gh pr command moves the lane on by itself", () => {
    const steps = ["Build", "Draft PRs", "?Your OK", "Ready", "Test path"];
    const lane = setStep(setLane(run([ev(prompt)]), "blk-1", "feature", steps), "blk-1", "Build", "slice 2")!;
    const gh = (pr_verb: string) => ev({ ...stop, hook_event_name: "PostToolUse", pr_verb });
    const at = (m: Map<string, Session>) => only(m).lane?.at;
    test("gh pr create: to the PR step, dropping the note", () =>
        expect(only(reduceSession(lane, gh("create"), 5000)).lane).toEqual({ name: "feature", steps, at: 1 }));
    test("gh pr ready: to Ready", () => expect(at(reduceSession(lane, gh("ready"), 5000))).toBe(3));
    test("never back: a second PR in the stack while on Ready", () =>
        expect(at(reduceSession(reduceSession(lane, gh("ready"), 5000), gh("create"), 6000))).toBe(3));
    test("other verbs, and lanes without such a step, stay put", () => {
        expect(at(reduceSession(lane, gh("view"), 5000))).toBe(0);
        const plain = setLane(run([ev(prompt)]), "blk-1", "investigate", ["Query", "Answer"]);
        expect(at(reduceSession(plain, gh("create"), 5000))).toBe(0);
    });
});

describe("the current step's to-dos (`wintos todo`)", () => {
    const m = setStep(setLane(run([ev(prompt)]), "blk-1", "feature", ["Build", "Test path", "Ready"]), "blk-1", "Test path")!;
    const todos = (x: Map<string, Session>) => only(x).lane?.todos;
    test("a list for the step now, all open", () =>
        expect(todos(setTodo(m, "blk-1", ["Narrow list", "Name search"])!)).toEqual([{ text: "Narrow list", done: false }, { text: "Name search", done: false }]));
    test("ticked by name, any case, or by its start; an unknown one is refused", () => {
        const t = setTodo(m, "blk-1", ["Narrow list", "Name search"])!;
        expect(todos(tickTodo(t, "blk-1", "name")!)).toEqual([{ text: "Narrow list", done: false }, { text: "Name search", done: true }]);
        expect(tickTodo(t, "blk-1", "Deploy")).toBeUndefined();
    });
    test("without a lane there is nothing to list", () => expect(setTodo(run([ev(prompt)]), "blk-1", ["x"])).toBeUndefined());
    test("the next step starts without them; the same step again keeps them", () => {
        const t = setTodo(m, "blk-1", ["Narrow list"])!;
        expect(todos(setStep(t, "blk-1", "Test path")!)).toHaveLength(1);
        expect(todos(setStep(t, "blk-1", "Ready")!)).toBeUndefined();
    });
});

describe("a pane running two sessions (a fork in the background)", () => {
    const two = run([ev(prompt), ev({ ...prompt, session_id: "fork" })]);
    test("a `wintos` call that names its session reaches that one, not the pane's latest", () => {
        const m = setStatus(two, "blk-1", "the fork's line", 5000, prompt.session_id);
        expect([m.get(prompt.session_id)?.status?.text, m.get("fork")?.status]).toEqual(["the fork's line", undefined]);
    });
    test("without a name, the one you last prompted there", () => {
        const m = run([ev(prompt), ev({ ...prompt, session_id: "fork" }), ev({ ...stop, session_id: "fork" }), ev({ ...stop, hook_event_name: "PostToolUse", session_id: prompt.session_id })]);
        expect(setStatus(m, "blk-1", "x", 9000).get("fork")?.status?.text).toBe("x");
        expect(liveSessionsIn(m.values(), "blk-1").map((s) => s.id)).toEqual(["fork", prompt.session_id]);
    });
});

describe("a session that also runs in Claude's background service", () => {
    const fg = (name: string, id: string, block: string, extra = {}) => ev({ hook_event_name: name, session_id: id, ...extra }, "tab-1", block);
    const bg = (name: string, id: string, block: string) => ev({ hook_event_name: name, session_id: id, kind: "bg" }, "tab-1", block);

    test("known only from the background, it is a background session; its pane's own session is not touched", () => {
        let s = reduceSession(new Map(), fg("UserPromptSubmit", "pane", "left", { resume: "claude --resume 'pane'" }), 1);
        s = reduceSession(s, bg("UserPromptSubmit", "fork", "left"), 2);
        expect([s.get("fork")?.background, s.get("pane")?.state]).toEqual([true, "working"]);
    });

    test("resumed in a pane it is that pane's, and its background copy's events no longer move or change it", () => {
        let s = reduceSession(new Map(), bg("UserPromptSubmit", "fork", "left"), 1);
        s = reduceSession(s, fg("UserPromptSubmit", "fork", "right", { resume: "claude --resume 'fork'" }), 2);
        s = reduceSession(s, bg("Stop", "fork", "left"), 3);
        expect([s.get("fork")?.blockId, s.get("fork")?.background, s.get("fork")?.state]).toEqual(["right", undefined, "working"]);
    });

    test("a pane switching to its real session clears the never-prompted Claude it started with", () => {
        let s = reduceSession(new Map(), fg("SessionStart", "empty", "left", { source: "startup" }), 1);
        s = reduceSession(s, fg("UserPromptSubmit", "luna", "left", { resume: "claude --resume 'luna'" }), 2);
        expect([...s.keys()]).toEqual(["luna"]);
    });
});

describe("a pane attached to a session that runs in the background service", () => {
    const fg = (name: string, id: string, block: string, extra = {}) => ev({ hook_event_name: name, session_id: id, ...extra }, "tab-1", block);
    test("pinned to the pane that shows it, the service's events (from an old pane's id) no longer move it", () => {
        let s = reduceSession(new Map(), fg("UserPromptSubmit", "fork", "old"), 1);
        s = attachSession(s, "fork", "tab-2", "viewer");
        s = reduceSession(s, fg("Stop", "fork", "old"), 2);
        expect([s.get("fork")?.blockId, s.get("fork")?.tabId, s.get("fork")?.state]).toEqual(["viewer", "tab-2", "waiting"]);
    });
    test("its state follows the service's events, marked background or not", () => {
        let s = attachSession(reduceSession(new Map(), fg("UserPromptSubmit", "fork", "old"), 1), "fork", "tab-1", "viewer");
        s = reduceSession(s, ev({ hook_event_name: "Stop", session_id: "fork", kind: "bg" }, "tab-1", "old"), 2);
        expect([s.get("fork")?.blockId, s.get("fork")?.state, s.get("fork")?.background]).toEqual(["viewer", "waiting", undefined]);
    });
    test("the pin lifts when the session really runs in a pane: its own Claude reports it with a resume command", () => {
        let s = attachSession(reduceSession(new Map(), fg("UserPromptSubmit", "fork", "old"), 1), "fork", "tab-1", "viewer");
        s = reduceSession(s, fg("UserPromptSubmit", "fork", "real", { resume: "claude --resume 'fork'" }), 2);
        expect([s.get("fork")?.blockId, s.get("fork")?.attachedTo]).toEqual(["real", undefined]);
    });
    test("an unknown or ended session is not pinned", () => {
        expect(attachSession(new Map(), "nobody", "t", "b").size).toBe(0);
        const ended = new Map([["x", { id: "x", tabId: "t", blockId: "b", state: "ended", since: 0, lastAt: 0 } as Session]]);
        expect(attachSession(ended, "x", "t", "c").get("x")?.blockId).toBe("b");
    });
});
