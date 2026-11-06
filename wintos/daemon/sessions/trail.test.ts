import { expect, test } from "vitest";
import type { Session } from "./reduce";
import { trail } from "./trail";

const s = (o: Partial<Session> = {}): Session => ({ id: "abcdef123456", tabId: "tab-1", blockId: "blk-1", state: "working", since: 0, lastAt: 0, ...o });
const m = (...list: Session[]) => new Map(list.map((x) => [x.id, x]));
const title = (t: string) => (t === "tab-1" ? "Intake" : undefined);

test("what moved, and who moved it", () =>
    expect(trail(m(s()), m(s({ state: "parked", parkedOn: "CI on #12", subagents: { a: 1 } })), "wintos wait", title)).toEqual([
        'session abcdef12 (Intake) ← wintos wait: state working → parked; parked on "CI on #12"; subagents 0 → 1',
    ]));

test("a new session and one gone", () =>
    expect(trail(m(s({ id: "old000000" })), m(s()), "hook SessionStart", title)).toEqual(["session abcdef12 (Intake) ← hook SessionStart: new, working", "session old00000 (Intake) ← hook SessionStart: gone"]));

test("nothing that matters changed: no line (lastAt moves on every event)", () => expect(trail(m(s()), m(s({ lastAt: 99 })), "hook Notification", title)).toEqual([]));

test("asks, a pending done and a name", () =>
    expect(trail(m(s({ state: "waiting" })), m(s({ state: "waiting", ask: { kind: "decide", by: "model" }, donePending: true, name: { text: "fix", by: "session", at: 1 } })), "x", title)[0]).toBe(
        'session abcdef12 (Intake) ← x: asks none → decide (model); done pending none → yes; named "fix" by session',
    ));

test("a prompt to a turn already running still leaves a line", () =>
    expect(trail(m(s()), m(s({ lastAt: 5 })), "hook UserPromptSubmit (you sent 12 characters)", title, "abcdef123456")).toEqual(["session abcdef12 (Intake) ← hook UserPromptSubmit (you sent 12 characters): unchanged, working"]));
