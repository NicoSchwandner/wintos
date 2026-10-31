import { describe, expect, test } from "vitest";
import { parseTitle, titlePrompt } from "./title";

describe("parseTitle", () => {
    test("the first line, without quotes or a closing full stop", () => expect(parseTitle('\n"Deploy HeartMcp stack to test."\nmore')).toBe("Deploy HeartMcp stack to test"));
    test("a sentence is no title", () => expect(parseTitle("We're getting the stack deployed and tested, and the UI test paths passed so far")).toBeUndefined());
    test("nothing is no title", () => expect(parseTitle("  \n")).toBeUndefined());
});

test("the prompt carries what the session was about", () => {
    const p = titlePrompt({ project: "Microteam MD", gist: "We're deploying the stack", status: "walking the test plan", label: "I'm back now" });
    for (const s of ["Microteam MD", "We're deploying the stack", "walking the test plan", "I'm back now", "3 to 6 words"]) expect(p).toContain(s);
});
