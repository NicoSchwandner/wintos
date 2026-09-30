import { globalStore } from "@/app/store/jotaiStore";
import { getLayoutModelForStaticTab } from "@/layout/index";
import { useAtom, useAtomValue } from "jotai";
import { magnifyBlock } from "./focus";
import { memo, useEffect } from "react";
import { takeInboxHandoff } from "./inbox";
import { Key } from "./Key";
import { inboxListAtom, type InboxList } from "./notes/state";
import { OnCallList } from "./OnCallList";
import { PrQueue } from "./PrQueue";
import { PaneStrip } from "./PaneStrip";
import { T } from "./tokens";

const LISTS: { list: InboxList; label: string; key: string }[] = [
    { list: "prs", label: "PRs", key: "⇧⌘G" },
    { list: "oncall", label: "On call", key: "⇧⌘O" },
];

// The Inbox tab: what belongs to no project. The list on the left; what it opens lives on the
// right as ordinary panes in this tab's own layout, the same browser panes a project has.
export const InboxArea = memo(({ tabId, empty, children }: { tabId: string; empty: boolean; children: React.ReactNode }) => {
    const [list, setList] = useAtom(inboxListAtom);
    // The Inbox reads one page at a time, never tiled: whatever closed a page (⌘W, the page
    // itself, a clean-up), the page left comes to the front.
    const lm = getLayoutModelForStaticTab();
    const magnified = useAtomValue(lm.magnifiedNodeIdAtom);
    const pages = useAtomValue(lm.leafOrder);
    useEffect(() => {
        if (magnified || !pages.length) return;
        magnifyBlock(globalStore.get(lm.focusedNode)?.data?.blockId ?? pages[pages.length - 1].blockid);
    }, [magnified, pages.length]);
    useEffect(() => {
        takeInboxHandoff();
        window.addEventListener("storage", takeInboxHandoff);
        document.addEventListener("visibilitychange", takeInboxHandoff);
        return () => (window.removeEventListener("storage", takeInboxHandoff), document.removeEventListener("visibilitychange", takeInboxHandoff));
    }, []);
    return (
        <div className="flex flex-row flex-grow min-w-0" style={{ minHeight: 0 }}>
            {/* With no page open the list has the whole width; a page takes the right side. */}
            <div data-wintos="inbox" style={{ ...(empty ? { flexGrow: 1, minWidth: 0 } : { width: "44%", minWidth: 440, flexShrink: 0 }), display: "flex", flexDirection: "column", minHeight: 0, borderRight: empty ? "none" : `1px solid ${T.border}`, background: T.ground }}>
                <div style={{ padding: "16px 26px 10px", display: "flex", alignItems: "center", gap: 18, WebkitAppRegion: "drag" } as React.CSSProperties}>
                    <span style={{ fontFamily: T.display, fontSize: 30, lineHeight: 1, color: T.emphasis }}>Inbox</span>
                    {LISTS.map((l) => (
                        <button
                            key={l.list}
                            type="button"
                            // Neither a click nor Tab leaves focus on the button, outside every zone.
                            onMouseDown={(e) => e.preventDefault()}
                            tabIndex={-1}
                            onClick={() => setList(l.list)}
                            style={{ WebkitAppRegion: "no-drag", display: "inline-flex", alignItems: "center", gap: 8, padding: "4px 10px", borderRadius: 8, cursor: "pointer", fontFamily: T.ui, fontSize: 13, color: list === l.list ? T.title : T.muted, background: list === l.list ? T.cardActive : "transparent", border: `1px solid ${list === l.list ? T.borderActive : "transparent"}` } as React.CSSProperties}
                        >
                            {l.label}
                            <Key k={l.key} label="" />
                        </button>
                    ))}
                </div>
                {list === "prs" ? <PrQueue pageOpen={!empty} /> : <OnCallList pageOpen={!empty} />}
            </div>
            {!empty && (
                <div className="flex flex-col flex-grow min-w-0" style={{ minHeight: 0 }}>
                    <PaneStrip tabId={tabId} />
                    {children}
                </div>
            )}
        </div>
    );
});
InboxArea.displayName = "InboxArea";
