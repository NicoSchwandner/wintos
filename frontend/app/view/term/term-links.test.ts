// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { findPathLinks, makeTermLinkHandlers, paneCwd, resolvePathLink } from "./term-links";

function linkEvent(metaKey = false, ctrlKey = false, shiftKey = false): MouseEvent {
    return { metaKey, ctrlKey, shiftKey, preventDefault: vi.fn(), clientX: 12, clientY: 34 } as unknown as MouseEvent;
}

describe("terminal link handlers", () => {
    it.each([
        { isMacOS: true, modifier: "metaKey" },
        { isMacOS: false, modifier: "ctrlKey" },
    ])("only opens $modifier-clicked links on the corresponding platform", ({ isMacOS }) => {
        const openUri = vi.fn();
        const handlers = makeTermLinkHandlers(isMacOS, openUri, vi.fn());
        const plainClick = linkEvent();
        handlers.activate(plainClick, "https://example.com/first");
        expect(plainClick.preventDefault).toHaveBeenCalledOnce();
        expect(openUri).not.toHaveBeenCalled();

        const wrongModifier = linkEvent(!isMacOS, isMacOS);
        handlers.activate(wrongModifier, "https://example.com/second");
        expect(openUri).not.toHaveBeenCalled();

        const rightModifier = linkEvent(isMacOS, !isMacOS);
        handlers.activate(rightModifier, "https://example.com/third");
        expect(openUri).toHaveBeenCalledExactlyOnceWith("https://example.com/third", false);
    });

    it("opens a shift-modifier-clicked URL in the default browser", () => {
        const openUri = vi.fn();
        makeTermLinkHandlers(true, openUri, vi.fn()).activate(linkEvent(true, false, true), "https://example.com/out");
        expect(openUri).toHaveBeenCalledExactlyOnceWith("https://example.com/out", true);
    });

    it("shows the destination for OSC 8 links but keeps plain URL hover unchanged", () => {
        const onHover = vi.fn();
        const handlers = makeTermLinkHandlers(false, vi.fn(), onHover);
        handlers.hover(linkEvent(), "https://example.com/visible");
        handlers.osc8Hover(linkEvent(), "https://example.com/hidden");
        handlers.leave();
        expect(onHover.mock.calls).toEqual([
            ["https://example.com/visible", 12, 34, false],
            ["https://example.com/hidden", 12, 34, true],
            [null, 0, 0, false],
        ]);
    });
});

describe("file path links", () => {
    it("opens a path in a preview on ⌘-click and externally with shift", () => {
        const openPath = vi.fn();
        const handlers = makeTermLinkHandlers(true, vi.fn(), vi.fn(), openPath);
        handlers.activatePath(linkEvent(), "/a.md");
        handlers.activatePath(linkEvent(true), "/b.md");
        handlers.activatePath({ ...linkEvent(true), shiftKey: true } as MouseEvent, "/c.md");
        expect(openPath.mock.calls).toEqual([
            ["/b.md", false],
            ["/c.md", true],
        ]);
    });

    it.each([
        ["ready at agentknowledge-mcp-setup/coder-routine.md. It first", ["agentknowledge-mcp-setup/coder-routine.md"]],
        ["see ~/notes/a.md, ./b.ts:42 and /tmp/c.json", ["~/notes/a.md", "./b.ts", "/tmp/c.json"]],
        ["(README.md)", ["README.md"]],
        ["open https://example.com/x/page.html now", []],
        ["no paths here at all", []],
    ])("finds the paths in %j", (line, expected) => {
        expect(findPathLinks(line).map((l) => l.text)).toEqual(expected);
    });

    it("reports where a path starts and ends", () => {
        expect(findPathLinks("at a/b.md.")).toEqual([{ text: "a/b.md", start: 3, end: 9 }]);
    });

    it.each([
        ["a/b.md", "/home/me/repo", "/home/me/repo/a/b.md"],
        ["./a/b.md", "/home/me/repo/", "/home/me/repo/a/b.md"],
        ["/tmp/c.md", "/home/me/repo", "/tmp/c.md"],
        ["~/c.md", "/home/me/repo", "~/c.md"],
        ["a/b.md", undefined, undefined],
    ])("resolves %s against %s", (text, cwd, expected) => {
        expect(resolvePathLink(text, cwd)).toBe(expected);
    });

    it.each([
        [{ "cmd:cwd": "/w" }, "/w"],
        [{ "cmd:initscript": "cd '/a/it'\\''s' && claude --resume 'x'" }, "/a/it's"],
        [{ "cmd:cwd": "/w", "cmd:initscript": "cd '/a' && claude" }, "/w"],
        [{}, undefined],
    ])("takes the pane's directory from %j", (meta, expected) => {
        expect(paneCwd(meta)).toBe(expected);
    });
});
