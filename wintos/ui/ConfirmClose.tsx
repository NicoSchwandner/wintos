import { globalStore } from "@/app/store/jotaiStore";
import { getWaveObjectAtom, makeORef } from "@/app/store/wos";
import { atoms } from "@/store/global";
import { memo } from "react";
import { closeOverlay, latestSessions } from "./focus";
import { Key } from "./Key";
import { closeWarning } from "./sessions";
import { T } from "./tokens";
import { useFocusOnMount } from "./useFocusOnMount";

// ⇧⌘W on a project with Claude sessions: ⇧⌘W again closes (handled by the key), esc keeps it.
export const ConfirmClose = memo(() => {
    const ref = useFocusOnMount<HTMLDivElement>();
    const tabId = globalStore.get(atoms.staticTabId);
    const name = globalStore.get(getWaveObjectAtom<Tab>(makeORef("tab", tabId)))?.name ?? "this project";
    return (
        <div style={{ position: "absolute", inset: 0, zIndex: 100, background: "rgba(15,16,17,0.6)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={closeOverlay}>
            <div
                ref={ref}
                tabIndex={0}
                data-wintos="confirm-close"
                data-zone="overlay"
                onClick={(e) => e.stopPropagation()}
                style={{ padding: "22px 26px", background: "#1d2021", border: `1px solid ${T.borderActive}`, borderRadius: 12, fontFamily: T.ui, outline: "none", display: "flex", flexDirection: "column", gap: 14 }}
            >
                <span style={{ fontFamily: T.display, fontSize: 24, color: T.emphasis }}>Close {name}?</span>
                <span style={{ fontSize: 13, color: T.secondary }}>{closeWarning(latestSessions(), tabId)}.</span>
                <div style={{ display: "flex", gap: 22 }}>
                    <Key k="⇧⌘W" label="close" />
                    <Key k="esc" label="keep it" />
                </div>
            </div>
        </div>
    );
});
ConfirmClose.displayName = "ConfirmClose";
