import type { Session } from "../daemon/sessions/reduce";

// The sessions that work a roadmap step: those linked to it, and any open session in the epic
// owning a PR the step names ("Core#14715 on test" → the session with Core's PR 14715), so a step
// leads to its session even when the session never claimed it. Never the epic's agent.
export function stepSessions(step: string, linked: string[], sessions: Session[], epic: { id: string; agent?: string }): string[] {
    const named = new Set([...step.matchAll(/([\w.-]+)\s?#(\d+)/g)].map((m) => `${m[1].toLowerCase()}#${m[2]}`));
    const owns = (s: Session) =>
        (s.prs ?? []).some((url) => {
            const m = /github\.com\/[^/]+\/([^/]+)\/pull\/(\d+)/.exec(url);
            return !!m && named.has(`${m[1].toLowerCase()}#${m[2]}`);
        });
    const byPr = named.size ? sessions.filter((s) => s.epic === epic.id && s.state !== "ended" && owns(s)).map((s) => s.id) : [];
    return [...new Set([...linked, ...byPr])].filter((id) => id !== epic.agent);
}
