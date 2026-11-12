import type { Session } from "../daemon/sessions/reduce";

// The one rule for typing text into a session's pane, whatever it is (a wake, an epic report, a
// relay): it is this window's tab's, it has a pane, its Claude runs (not restored, not yet
// started) and is not at work, and you are not in that pane (typing over what you write would
// mix the two). A background session has no pane: the daemon sends it through the background
// service instead. lookingAt undefined: delivered even where you are (a wake you waited for).
export function canTypeInto(s: Session | undefined, tabId: string, lookingAt?: string): s is Session {
    return !!s && s.state !== "ended" && s.state !== "working" && !s.restored && s.tabId === tabId && !!s.blockId && !(s.bgId && !s.attachedTo) && s.blockId !== lookingAt;
}
