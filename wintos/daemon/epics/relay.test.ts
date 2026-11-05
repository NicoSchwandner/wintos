import { describe, expect, test } from "vitest";
import type { Session } from "../sessions/reduce";
import { addRelay, findWorker, relayPrompt, relaysDelivered, youSaid } from "./relay";

const s = (id: string, more: Partial<Session> = {}) => ({ id, tabId: "t", blockId: `b-${id}`, state: "waiting", since: 0, lastAt: 0, epic: "e", ...more }) as Session;
const sessions = [s("agent", { name: { text: "Backstage agent", by: "you" } as Session["name"] }), s("w14715", { name: { text: "#14715 receipt-to-Ada todo review", by: "model" } as Session["name"] }), s("w2", { label: "drafts shadow" }), s("gone", { state: "ended", label: "old one" }), s("other", { epic: "x", label: "#14715 elsewhere" })];

describe("findWorker", () => {
    test("by the start of its name, its id, or the roadmap step it works", () => {
        expect(findWorker(sessions, "e", "agent", "#14715")?.id).toBe("w14715");
        expect(findWorker(sessions, "e", "agent", "w2")?.id).toBe("w2");
        expect(findWorker(sessions, "e", "agent", "Cutover", { Cutover: ["w2"] })?.id).toBe("w2");
    });
    test("in no epic: the sessions without one", () => {
        expect(findWorker([...sessions, s("loose", { epic: undefined, label: "loose end" })], undefined, "agent", "loose")?.id).toBe("loose");
    });
    test("never the agent itself, an ended session, another epic's, or a two-letter guess", () => {
        expect(findWorker(sessions, "e", "agent", "backstage agent")).toBeUndefined();
        expect(findWorker(sessions, "e", "agent", "old one")).toBeUndefined();
        expect(findWorker(sessions, "e", "agent", "#14715 elsewhere")).toBeUndefined();
        expect(findWorker(sessions, "e", "agent", "#1")).toBeUndefined();
    });
});

test("only words you said to the agent pass, spaces and case aside", () => {
    expect(youSaid("Write the checklist first,\nthen walk it", "write the checklist first, then walk it")).toBe(true);
    expect(youSaid("Write the checklist first", "merge it")).toBe(false);
    expect(youSaid(undefined, "anything")).toBe(false);
    expect(youSaid("ok", "  ")).toBe(false);
});

test("the agent's own words are marked as its, never as yours", () => {
    expect(relayPrompt({ text: "pick up the review thread", from: "agent", at: 0, own: true }, "Route DO")).toBe("[The Route DO agent, not the developer] pick up the review thread");
});

test("the prompt marks your words and the agent's note apart", () => {
    expect(relayPrompt({ text: "checklist first", from: "agent", at: 0 }, "Backstage")).toBe("[You, via the Backstage agent] checklist first");
    expect(relayPrompt({ text: "yes", note: "re the test-plan question", from: "agent", at: 0 }, "Backstage")).toBe("[You, via the Backstage agent] yes\n[The Backstage agent's note, not the developer's: re the test-plan question]");
});

test("queued per session, taken off once typed in", () => {
    const r = addRelay(addRelay({}, "w2", { text: "a", from: "agent", at: 1 }), "w2", { text: "b", from: "agent", at: 2 });
    expect(relaysDelivered(r, "w2", 1)).toEqual({ w2: [{ text: "b", from: "agent", at: 2 }] });
    expect(relaysDelivered(r, "w2", 2)).toEqual({});
});
