import { canTypeInto } from "./outbox";
import { wakeId, wakePrompt, type Wakes } from "../daemon/wakes/wakes";
import { resumeScriptOf, type Session } from "../daemon/sessions/reduce";
import type { Shelved } from "../daemon/shelf/shelf";

// What this window does about the due wakes of its own tab: type one into its session's pane
// between turns (a prompt typed mid-turn would queue behind work the session is still doing), or
// resume a shelved session in a new pane, which is typed into once it runs.
// A session with two due wakes gets one at a time: typing the first starts a turn.
// wake-resume: a paused session is started again in its own pane first; the wake is typed in once it runs.
export type Delivery = { kind: "type"; id: string; sessionId: string; blockId: string; text: string } | { kind: "resume"; sessionId: string; script: string } | { kind: "wake-resume"; sessionId: string; blockId: string; script: string };
export function deliverable(wakes: Wakes, sessions: Session[], shelf: Shelved[], tabId: string): Delivery[] {
    return Object.values(wakes).flatMap((w): Delivery[] => {
        if (!w.due) return [];
        const s = sessions.find((x) => x.id === w.sessionId && x.state !== "ended");
        // Typed even while you are in its pane: it is the wake you waited for.
        const script = s?.paused && s.tabId === tabId && s.blockId ? resumeScriptOf(s) : undefined;
        if (s && script) return [{ kind: "wake-resume", sessionId: s.id, blockId: s.blockId, script }];
        if (s) return canTypeInto(s, tabId) ? [{ kind: "type", id: wakeId(w), sessionId: s.id, blockId: s.blockId, text: wakePrompt(w) }] : [];
        const shelved = shelf.find((x) => x.sessionId === w.sessionId);
        return shelved ? [{ kind: "resume", sessionId: w.sessionId, script: shelved.script }] : [];
    });
}

// Due wakes of projects whose tab is closed: nothing runs; they wait in the sidebar, and opening
// one reopens its project on the waking session, which is then typed into as usual.
// news: a merge or a release asks nothing of you, so it waits in To read rather than Your move.
export type ClosedWake = { projectId: string; title: string; sessionId: string; script: string; due: number; line: string; news: boolean };
export function closedWakes(wakes: Wakes, shelf: Record<string, Shelved[]>, projects: { id?: string; title?: string }[], tabIds: string[], ref: (url: string) => string): ClosedWake[] {
    const due = Object.values(wakes).filter((w) => w.due);
    // One row per session, for its first due wake: opening it delivers the rest in turn.
    return due.filter((w, i) => due.findIndex((x) => x.sessionId === w.sessionId) === i).flatMap((w) => {
        const projectId = Object.keys(shelf).find((id) => !tabIds.includes(id) && shelf[id].some((x) => x.sessionId === w.sessionId));
        const item = projectId && shelf[projectId].find((x) => x.sessionId === w.sessionId);
        if (!projectId || !item) return [];
        return [{ projectId, title: projects.find((p) => p.id === projectId)?.title ?? "Closed project", sessionId: w.sessionId, script: item.script, due: w.due, line: `${ref(w.pr)} ${WOKE[w.until]} · opening it resumes the session`, news: w.until === "merged" || w.until === "released" }];
    });
}
export const WOKE = { green: "went green", merged: "was merged", released: "was released", rereview: "asks for your re-review", comments: "got review feedback" } as const;

// A pane of this tab already resuming the session (reopening the project on it): one more would
// run the same session twice.
export const resumes = (scripts: (string | undefined)[], sessionId: string) => scripts.some((x) => x?.includes(`--resume '${sessionId}'`));
