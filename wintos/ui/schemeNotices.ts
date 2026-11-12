import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { stringToBase64 } from "@/util/util";
import { useEffect, useRef, useState } from "react";
import type { Session } from "../daemon/sessions/reduce";
import { lightSchemeAtom } from "./scheme";
import { schemeNotices, schemeReport } from "./termScheme";

// Claude answers the report by asking the pane for its background, which only a loaded terminal
// answers; this tab's terminals load right after the window opens.
const LOADED_MS = 3000;

// Tell each Claude session in this tab the appearance once; flips after that are the pane's to
// report, sent only once its own colour has changed (TermWrap.setSchemeBg).
export function useSchemeNotices(sessions: Session[] | undefined, tabId: string): void {
    const told = useRef(new Set<string>());
    const [ready, setReady] = useState(false);
    useEffect(() => void setTimeout(() => setReady(true), LOADED_MS), []);
    useEffect(() => {
        if (!ready || !sessions) return;
        const report = schemeReport(!globalStore.get(lightSchemeAtom));
        for (const blockId of schemeNotices(sessions, tabId, told.current)) {
            told.current.add(blockId);
            void RpcApi.ControllerInputCommand(TabRpcClient, { blockid: blockId, inputdata64: stringToBase64(report) }).catch(() => told.current.delete(blockId));
        }
    }, [ready, sessions, tabId]);
}
