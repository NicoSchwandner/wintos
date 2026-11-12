import type { Session } from "../sessions/reduce";
import type { Epic } from "./epics";

// Which epic a session without one belongs to, when nobody said: the epic of the session it was
// started beside (the newest other session in its tab that has one), else the epic whose lane it
// follows. Undefined: it waits for you or the session to say.
export function impliedEpic(s: Session, sessions: Session[], epics: Epic[]): string | undefined {
    const live = new Set(epics.filter((e) => !e.done).map((e) => e.id));
    const beside = sessions
        .filter((x) => x.id !== s.id && x.tabId === s.tabId && x.epic && live.has(x.epic))
        .sort((a, b) => b.lastAt - a.lastAt)[0]?.epic;
    if (beside) return beside;
    return s.lane ? epics.find((e) => !e.done && e.lane === s.lane!.name)?.id : undefined;
}
