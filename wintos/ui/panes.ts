import type { Session } from "../daemon/sessions/reduce";

// The pane strip, in projects and the Inbox alike: one chip per pane of the tab.
export type PaneChip = { blockId: string; kind: "session" | "terminal" | "web" | "other"; label: string; session?: Session };

const GITHUB_PR = /^https:\/\/github\.com\/[^/]+\/([^/]+)\/pull\/(\d+)/;

function pageLabel(url: string): string {
    const pr = GITHUB_PR.exec(url);
    if (pr) return `${pr[1]} #${pr[2]}`;
    try {
        return new URL(url).hostname;
    } catch {
        return url;
    }
}

export function stripPanes(blocks: (Block | undefined)[], sessions: Session[]): PaneChip[] {
    return blocks.filter((b): b is Block => !!b).map((b): PaneChip => {
        const view = b.meta?.view;
        const session = sessions.find((s) => s.blockId === b.oid && s.state !== "ended");
        if (view === "term" && session) return { blockId: b.oid, kind: "session", label: session.label ?? "session", session };
        if (view === "term") return { blockId: b.oid, kind: "terminal", label: "terminal" };
        if (view === "web") return { blockId: b.oid, kind: "web", label: pageLabel(b.meta?.url ?? "") };
        return { blockId: b.oid, kind: "other", label: String(view ?? "pane") };
    });
}
