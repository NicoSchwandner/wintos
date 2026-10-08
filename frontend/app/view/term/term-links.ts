// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export function makeTermLinkHandlers(
    isMacOS: boolean,
    openUri: (uri: string) => void,
    onHover: (uri: string | null, x: number, y: number, showUrl: boolean) => void,
    openPath?: (path: string, external: boolean) => void
) {
    const modifier = (event: MouseEvent) => (isMacOS ? event.metaKey : event.ctrlKey);
    return {
        activate: (event: MouseEvent, uri: string) => {
            event.preventDefault();
            if (!modifier(event)) {
                return;
            }
            openUri(uri);
        },
        activatePath: (event: MouseEvent, path: string) => {
            event.preventDefault();
            if (modifier(event)) openPath?.(path, !!event.shiftKey);
        },
        hover: (event: MouseEvent, uri: string) => onHover(uri, event.clientX, event.clientY, false),
        osc8Hover: (event: MouseEvent, uri: string) => onHover(uri, event.clientX, event.clientY, true),
        leave: () => onHover(null, 0, 0, false),
    };
}

// A path ends in a file extension and is not part of a URL (the web-links addon owns those).
// ponytail: string offsets are used as cell columns, so a wide character earlier on the line shifts the underline.
const pathPattern = /(?<![\w/:.~-])(?:~\/|\.{1,2}\/|\/)?(?:[\w@+.-]+\/)*[\w@+-][\w@+.-]*\.[A-Za-z0-9]+(?![\w/])/g;

export function findPathLinks(line: string): { text: string; start: number; end: number }[] {
    return [...line.matchAll(pathPattern)].map((m) => ({ text: m[0], start: m.index, end: m.index + m[0].length }));
}

export function resolvePathLink(text: string, cwd: string | undefined): string | undefined {
    if (text.startsWith("/") || text.startsWith("~/")) return text;
    if (!cwd) return undefined;
    return `${cwd.replace(/\/$/, "")}/${text.replace(/^\.\//, "")}`;
}

// A WintOS Claude pane starts as `cd '<dir>' && claude …` and may not have reported its cwd yet.
export function paneCwd(meta: Record<string, any>): string | undefined {
    if (meta["cmd:cwd"]) return meta["cmd:cwd"];
    const cd = /^cd '((?:[^']|'\\'')*)'/.exec(meta["cmd:initscript"] ?? "");
    return cd?.[1].split("'\\''").join("'");
}
