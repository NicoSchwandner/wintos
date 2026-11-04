import type { Session } from "../sessions/reduce";

// Reports up: what a session of an epic did at the end of each of its turns, queued for the
// epic's agent and typed into it when it is free (ui/epicReports.ts). By agent session; the
// oldest go first once more than REPORTS_MAX wait.
export type Report = { text: string; at: number };
export type Reports = Record<string, Report[]>;
export const REPORTS_MAX = 20;

const ASKS = { answer: "asks", decide: "needs a decision", approve: "needs an approval", unblock: "is blocked" } as const;

// One line: who, where in its lane, how the turn ended, and what it asks of the developer.
export function reportLine(s: Session): string {
    const name = s.name?.text ?? s.label ?? "a session";
    const step = s.lane ? ` (at ${s.lane.steps[s.lane.at]?.replace(/^\?\s*/, "")})` : "";
    const ended = s.state === "waiting" && s.ask ? `${ASKS[s.ask.kind]}: ${s.ask.text ?? s.outcome?.text ?? "see its pane"}` : s.state === "parked" ? `waits on ${s.parkedOn ?? "something outside"}` : s.state === "done" ? "is done" : (s.outcome?.text ?? "ended its turn");
    return `${name}${step} ${ended}`;
}

export function addReport(reports: Reports, agent: string, text: string, at: number): Reports {
    const was = (reports[agent] ?? []).filter((r) => r.text !== text);
    return { ...reports, [agent]: [...was, { text, at }].slice(-REPORTS_MAX) };
}

// The first n were typed into the agent; the rest wait.
export function delivered(reports: Reports, agent: string, n: number): Reports {
    const left = (reports[agent] ?? []).slice(n);
    const { [agent]: _, ...rest } = reports;
    return left.length ? { ...rest, [agent]: left } : rest;
}
