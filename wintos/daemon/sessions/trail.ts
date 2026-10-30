import type { Session } from "./reduce";

// One line per session a change moved, for reading back later what happened to it and who did
// it: its state, what it asks, its park, a pending done/ask/wait, its status, name, step,
// subagents and pane. Never what the developer typed: a prompt is only its length, in cause.
// always: a session that gets a line even when nothing moved (a prompt sent to a running turn).
export function trail(before: Map<string, Session>, after: Map<string, Session>, cause: string, title: (tabId: string) => string | undefined, always?: string): string[] {
    const lines: string[] = [];
    for (const s of after.values()) {
        const was = before.get(s.id);
        const moved = changes(was, s);
        const what = moved.length || s.id !== always ? moved : [`unchanged, ${s.state}`];
        if (what.length) lines.push(`session ${s.id.slice(0, 8)} (${title(s.tabId) ?? s.tabId.slice(0, 8)}) ← ${cause}: ${what.join("; ")}`);
    }
    for (const s of before.values()) if (!after.has(s.id)) lines.push(`session ${s.id.slice(0, 8)} (${title(s.tabId) ?? s.tabId.slice(0, 8)}) ← ${cause}: gone`);
    return lines;
}

const quote = (t: string | undefined) => (t === undefined ? "none" : JSON.stringify(t));

function changes(was: Session | undefined, s: Session): string[] {
    if (!was) return [`new, ${s.state}`];
    const out: string[] = [];
    const diff = (label: string, a: string | undefined, b: string | undefined) => a !== b && out.push(`${label} ${a ?? "none"} → ${b ?? "none"}`);
    diff("state", was.state, s.state);
    diff("asks", was.ask && `${was.ask.kind} (${was.ask.by})`, s.ask && `${s.ask.kind} (${s.ask.by})`);
    if (was.parkedOn !== s.parkedOn) out.push(`parked on ${quote(s.parkedOn)}`);
    diff("wait pending", was.parkPending ? "yes" : undefined, s.parkPending ? "yes" : undefined);
    diff("done pending", was.donePending ? "yes" : undefined, s.donePending ? "yes" : undefined);
    diff("ask pending", was.askPending?.kind, s.askPending?.kind);
    if (was.status?.text !== s.status?.text) out.push(`status ${quote(s.status?.text)}`);
    if (was.name?.text !== s.name?.text) out.push(`named ${quote(s.name?.text)} by ${s.name?.by ?? "none"}`);
    const step = (x: Session) => x.lane && `${x.lane.name}: ${x.lane.steps[x.lane.at] ?? "end"}`;
    diff("step", step(was), step(s));
    const subs = (x: Session) => String(Object.keys(x.subagents ?? {}).length);
    diff("subagents", subs(was), subs(s));
    if (was.blockId !== s.blockId) out.push(`moved to pane ${s.blockId.slice(0, 6)}`);
    return out;
}
