import { getLayoutModelForStaticTab } from "@/layout/index";
import { useAtomValue } from "jotai";
import { memo } from "react";
import { EpicAvatar } from "./EpicAvatar";
import { lookOf, NO_EPIC } from "./epicLook";
import { Key } from "./Key";
import { openEpic, runKey } from "./menu";
import { T } from "./tokens";
import { useWintos } from "./useWintos";
import { sessionName } from "./view";

// Over the panes, in the focused session's epic colour: whose epic you are in and which step,
// so a glance at the top of the window says where you are. ⌥⌘E changes the epic; ⇧⌥⌘E, or a
// click on its name, opens the epic's page.
export const EpicStrip = memo(({ tabId }: { tabId: string }) => {
    const { state } = useWintos();
    const focused = useAtomValue(getLayoutModelForStaticTab().focusedNode)?.data?.blockId;
    const here = (state?.sessions ?? []).filter((s) => s.tabId === tabId && s.state !== "ended" && !s.background);
    const s = here.find((x) => x.blockId === focused) ?? (here.length === 1 ? here[0] : undefined);
    if (!s) return null;
    const epic = s.epic ? state?.epics?.find((e) => e.id === s.epic) : undefined;
    const look = epic ? lookOf(epic) : NO_EPIC;
    const others = epic ? (state?.sessions ?? []).filter((x) => x.epic === epic.id && x.state !== "ended" && !x.background).length - 1 : 0;
    // The right padding keeps clear of the notes rail's toggle, which floats over this corner.
    return (
        <div data-wintos="epic-strip" data-epic={epic?.id ?? ""} style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 12, padding: "8px 120px 8px 14px", background: `linear-gradient(90deg, ${look.bg} 0%, transparent 65%)`, borderTop: `3px solid ${epic ? look.fg : "transparent"}`, borderBottom: `1px solid ${T.border}`, fontFamily: T.ui, minWidth: 0 }}>
            <EpicAvatar look={look} size={32} />
            <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, flexGrow: 1 }}>
                {epic ? (
                    <button type="button" data-key="⇧⌥⌘E" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => openEpic(epic.id)} title="the epic's page (⇧⌥⌘E)" style={{ alignSelf: "flex-start", padding: 0, background: "transparent", border: "none", cursor: "pointer", fontFamily: T.mono, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: look.fg, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                        {epic.title}
                    </button>
                ) : (
                    <span style={{ fontFamily: T.mono, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: T.muted }}>No epic yet</span>
                )}
                <span style={{ fontFamily: T.display, fontSize: 20, lineHeight: 1.1, color: T.emphasis, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sessionName(s)}</span>
            </div>
            <span style={{ display: "flex", gap: 14, alignItems: "center", flexShrink: 0, fontFamily: T.mono, fontSize: 11.5, color: T.muted }}>
                {others > 0 && <span>{others} more in this epic</span>}
                <button type="button" data-key="⌥⌘E" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => runKey("epic")} style={{ padding: 0, background: "transparent", border: "none", cursor: "pointer" }}>
                    <Key k="⌥⌘E" label="epic" />
                </button>
            </span>
        </div>
    );
});
EpicStrip.displayName = "EpicStrip";
