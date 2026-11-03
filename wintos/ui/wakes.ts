import { globalStore } from "@/app/store/jotaiStore";
import { ObjectService } from "@/app/store/services";
import { getWaveObjectAtom, makeORef } from "@/app/store/wos";
import { getLayoutModelForStaticTab, LayoutTreeActionType, newLayoutNode, type LayoutTreeInsertNodeAction } from "@/layout/index";
import { useEffect } from "react";
import { type Wakes } from "../daemon/wakes/wakes";
import { deliverable, resumes } from "./wakePlan";
import type { Session } from "../daemon/sessions/reduce";
import type { Shelved } from "../daemon/shelf/shelf";
import { resumePane } from "./focus";
import { noteResume, resumingNow } from "./resuming";
import { typeIntoPane } from "./typeIntoPane";
import { daemonFetch } from "./useWintos";

export { closedWakes, deliverable, resumes, WOKE, type ClosedWake, type Delivery } from "./wakePlan";

// A pane beside the others that leaves your focus where it is.
async function addPaneQuietly(meta: MetaType): Promise<void> {
    const blockId = await ObjectService.CreateBlock({ meta }, { termsize: { rows: 25, cols: 80 } });
    const insert: LayoutTreeInsertNodeAction = { type: LayoutTreeActionType.InsertNode, node: newLayoutNode(undefined, undefined, undefined, { blockId }), magnified: false, focused: false };
    getLayoutModelForStaticTab().treeReducer(insert);
}

function tabScripts(tabId: string): (string | undefined)[] {
    const ids = globalStore.get(getWaveObjectAtom<Tab>(makeORef("tab", tabId)))?.blockids ?? [];
    return ids.map((id) => globalStore.get(getWaveObjectAtom<Block>(makeORef("block", id)))?.meta?.["cmd:initscript"] as string | undefined);
}

// Whichever window claims a wake first types it; the daemon says yes to one only. A resume is
// started once, then waits for the session to come up.
const busy = new Set<string>();
export function useWakeDelivery(wakes: Wakes | undefined, sessions: Session[] | undefined, shelf: Shelved[] | undefined, tabId: string): void {
    const due = wakes && sessions ? deliverable(wakes, sessions, shelf ?? [], tabId) : [];
    const key = due.map((d) => `${d.kind}:${d.sessionId}`).join(" ");
    useEffect(() => {
        for (const d of due) {
            if (busy.has(d.sessionId)) continue;
            if (d.kind === "resume") {
                if (resumingNow(d.sessionId) || resumes(tabScripts(tabId), d.sessionId)) continue;
                noteResume(d.script);
                void addPaneQuietly(resumePane(d.script)).catch(() => {});
                continue;
            }
            busy.add(d.sessionId);
            void daemonFetch(`/wakes/${encodeURIComponent(d.id)}/delivered`, { method: "POST", body: {} })
                .then((r) => (r.ok ? typeIntoPane(d.blockId, d.text) : undefined))
                .catch(() => {})
                .finally(() => busy.delete(d.sessionId));
        }
    }, [key]);
}
