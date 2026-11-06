// Sessions this window has started resuming in a pane, so a second route (a due wake) doesn't
// resume the same one again before it is up.
const started = new Map<string, number>();
const GRACE_MS = 3 * 60_000;
const idOf = (script: string) => /--resume '([\w-]+)'/.exec(script)?.[1];

export function noteResume(script: string | undefined, now = Date.now()): void {
    const id = script && idOf(script);
    if (id) started.set(id, now);
}
export const resumingNow = (sessionId: string, now = Date.now()) => now - (started.get(sessionId) ?? -Infinity) < GRACE_MS;
