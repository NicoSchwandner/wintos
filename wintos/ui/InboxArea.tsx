import { globalStore } from "@/app/store/jotaiStore";
import { getLayoutModelForStaticTab } from "@/layout/index";
import { useAtomValue } from "jotai";
import { magnifyBlock } from "./focus";
import { memo, useEffect } from "react";
import { takeInboxHandoff } from "./inbox";
import type { InboxList } from "./view";
import { OnCallList } from "./OnCallList";
import { PrQueue } from "./PrQueue";
import { PaneStrip } from "./PaneStrip";
import { T } from "./tokens";

// An Inbox tab, PRs or On call: what belongs to no project. The list on the left; what it opens
// lives on the right as ordinary panes in this tab's own layout, the same browser panes a
// project has. Each tab holds only its own pages.
export const InboxArea = memo(({ tabId, list, empty, children }: { tabId: string; list: InboxList; empty: boolean; children: React.ReactNode }) => {
    // One page at a time, never tiled: whatever closed a page (⌘W, the page itself, a clean-up),
    // the page left comes to the front.
    const lm = getLayoutModelForStaticTab();
    const magnified = useAtomValue(lm.magnifiedNodeIdAtom);
    const pages = useAtomValue(lm.leafOrder);
    useEffect(() => {
        // The last page closed: the list takes focus, it is all this tab has left.
        if (!pages.length) return void (document.activeElement === document.body && document.querySelector<HTMLElement>("[data-wintos=inbox-list]")?.focus());
        if (magnified) return;
        magnifyBlock(globalStore.get(lm.focusedNode)?.data?.blockId ?? pages[pages.length - 1].blockid);
    }, [magnified, pages.length]);
    useEffect(() => {
        const take = () => takeInboxHandoff(list);
        take();
        window.addEventListener("storage", take);
        document.addEventListener("visibilitychange", take);
        return () => (window.removeEventListener("storage", take), document.removeEventListener("visibilitychange", take));
    }, [list]);
    return (
        <div className="flex flex-row flex-grow min-w-0" style={{ minHeight: 0 }}>
            {/* With no page open the list has the whole width; a page takes the right side. */}
            <div data-wintos="inbox" style={{ ...(empty ? { flexGrow: 1, minWidth: 0 } : { width: "44%", minWidth: 440, flexShrink: 0 }), display: "flex", flexDirection: "column", minHeight: 0, borderRight: empty ? "none" : `1px solid ${T.border}`, background: T.ground }}>
                {/* The window drags here, as it did by the old header. */}
                <div style={{ height: 12, flexShrink: 0, WebkitAppRegion: "drag" } as React.CSSProperties} />
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
