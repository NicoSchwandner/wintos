import { ObjectService } from "@/app/store/services";
import { getLayoutModelForStaticTab, LayoutTreeActionType, newLayoutNode, type LayoutTreeInsertNodeAction } from "@/layout/index";
import { useEffect } from "react";
import { wakePrompt, type Wakes } from "../daemon/wakes/wakes";
import type { Session } from "../daemon/sessions/reduce";
import type { Shelved } from "../daemon/shelf/shelf";
import { resumePane } from "./focus";
import { typeIntoPane } from "./typeIntoPane";
import { daemonFetch } from "./useWintos";

// What this window does about the due wakes of its own tab: type one into its session's pane
// between turns (a prompt typed mid-turn would queue behind work the session is still doing), or
// resume a shelved session in a new pane, which is typed into once it runs.
export type Delivery = { kind: "type"; sessionId: string; blockId: string; text: string } | { kind: "resume"; sessionId: string; script: string };
export function deliverable(wakes: Wakes, sessions: Session[], shelf: Shelved[], tabId: string): Delivery[] {
    return Object.values(wakes).flatMap((w): Delivery[] => {
        if (!w.due) return [];
        const s = sessions.find((x) => x.id === w.sessionId && x.state !== "ended");
        if (s) return s.tabId === tabId && s.blockId && s.state !== "working" ? [{ kind: "type", sessionId: s.id, blockId: s.blockId, text: wakePrompt(w) }] : [];
        const shelved = shelf.find((x) => x.sessionId === w.sessionId);
        return shelved ? [{ kind: "resume", sessionId: w.sessionId, script: shelved.script }] : [];
    });
}

// Due wakes of projects whose tab is closed: nothing runs; they wait in Your move, and opening
// one reopens its project on the waking session, which is then typed into as usual.
export type ClosedWake = { projectId: string; title: string; sessionId: string; script: string; due: number; line: string };
export function closedWakes(wakes: Wakes, shelf: Record<string, Shelved[]>, projects: { id?: string; title?: string }[], tabIds: string[], ref: (url: string) => string): ClosedWake[] {
    return Object.values(wakes).flatMap((w) => {
        if (!w.due) return [];
        const projectId = Object.keys(shelf).find((id) => !tabIds.includes(id) && shelf[id].some((x) => x.sessionId === w.sessionId));
        const item = projectId && shelf[projectId].find((x) => x.sessionId === w.sessionId);
        if (!projectId || !item) return [];
        return [{ projectId, title: projects.find((p) => p.id === projectId)?.title ?? "Closed project", sessionId: w.sessionId, script: item.script, due: w.due, line: `${ref(w.pr)} ${WOKE[w.until]} · opening it resumes the session` }];
    });
}
const WOKE = { green: "went green", merged: "was merged", released: "was released", rereview: "asks for your re-review", comments: "got review feedback" } as const;

// A pane beside the others that leaves your focus where it is.
async function addPaneQuietly(meta: MetaType): Promise<void> {
    const blockId = await ObjectService.CreateBlock({ meta }, { termsize: { rows: 25, cols: 80 } });
    const insert: LayoutTreeInsertNodeAction = { type: LayoutTreeActionType.InsertNode, node: newLayoutNode(undefined, undefined, undefined, { blockId }), magnified: false, focused: false };
    getLayoutModelForStaticTab().treeReducer(insert);
}

// Whichever window claims a wake first types it; the daemon says yes to one only. A resume is
// started once, then waits for the session to come up.
const busy = new Set<string>();
const resumed = new Map<string, number>();
const RESUME_GRACE_MS = 3 * 60_000;
export function useWakeDelivery(wakes: Wakes | undefined, sessions: Session[] | undefined, shelf: Shelved[] | undefined, tabId: string): void {
    const due = wakes && sessions ? deliverable(wakes, sessions, shelf ?? [], tabId) : [];
    const key = due.map((d) => `${d.kind}:${d.sessionId}`).join(" ");
    useEffect(() => {
        for (const d of due) {
            if (busy.has(d.sessionId)) continue;
            if (d.kind === "resume") {
                if (Date.now() - (resumed.get(d.sessionId) ?? 0) < RESUME_GRACE_MS) continue;
                resumed.set(d.sessionId, Date.now());
                void addPaneQuietly(resumePane(d.script)).catch(() => {});
                continue;
            }
            busy.add(d.sessionId);
            void daemonFetch(`/wakes/${encodeURIComponent(d.sessionId)}/delivered`, { method: "POST", body: {} })
                .then((r) => (r.ok ? typeIntoPane(d.blockId, d.text) : undefined))
                .catch(() => {})
                .finally(() => busy.delete(d.sessionId));
        }
    }, [key]);
}
