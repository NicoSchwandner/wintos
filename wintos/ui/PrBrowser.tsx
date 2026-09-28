import { globalStore } from "@/app/store/jotaiStore";
import { getApi } from "@/store/global";
import { useAtom, useAtomValue } from "jotai";
import { memo, useRef, useState } from "react";
import { Key } from "./Key";
import { prCopiedAtom, prTabsAtom } from "./notes/state";
import { closeTab, openTab } from "./prtabs";
import { T } from "./tokens";
import { Webview } from "./Webview";

// The browser beside the PR queue: a tab per opened PR, and per link the page opens in a new
// window (⌘-click). Hidden tabs stay loaded, so switching keeps your place. A plain click
// navigates inside its tab (GitHub moves client-side, so it can't be caught); ← goes back.
let listening = false;
function listenForTabs(): void {
    if (listening) return;
    listening = true;
    getApi().onWintosOpenTab((url) => globalStore.set(prTabsAtom, (t) => openTab(t, url)));
}

export const PrBrowser = memo(() => {
    listenForTabs();
    const [tabs, setTabs] = useAtom(prTabsAtom);
    const copied = useAtomValue(prCopiedAtom);
    const [titles, setTitles] = useState<Record<string, string>>({});
    const views = useRef<Record<string, Electron.WebviewTag | null>>({});
    if (!tabs.urls.length) return null;
    const label = (url: string) => titles[url] ?? url.replace(/^https:\/\/github\.com\//, "");
    return (
        <div data-wintos="pr-browser" style={{ flexGrow: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", borderLeft: `1px solid ${T.border}` }}>
            <div style={{ height: 34, flexShrink: 0, padding: "0 8px", display: "flex", alignItems: "center", gap: 4, background: T.sidebar, borderBottom: `1px solid ${T.border}` }}>
                <button type="button" title="Back (⌘←)" onClick={() => views.current[tabs.urls[tabs.active]]?.goBack()} style={BTN}>←</button>
                <Key k="⌘←" label="" />
                <div style={{ flexGrow: 1, minWidth: 0, display: "flex", gap: 4, overflowX: "auto" }}>
                    {tabs.urls.map((url, i) => (
                        <span
                            key={url}
                            onClick={() => setTabs((t) => ({ ...t, active: i }))}
                            title={url}
                            style={{ flexShrink: 0, maxWidth: 220, display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 6px 4px 10px", borderRadius: 7, cursor: "pointer", fontSize: 11.5, color: i === tabs.active ? T.title : T.muted, background: i === tabs.active ? T.cardActive : "transparent", border: `1px solid ${i === tabs.active ? T.borderActive : "transparent"}` }}
                        >
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label(url)}</span>
                            <button type="button" title="Close tab (⌘W)" onClick={(e) => (e.stopPropagation(), setTabs((t) => closeTab(t, i)))} style={BTN}>×</button>
                        </span>
                    ))}
                </div>
                <Key k="⌥⌘← →" label="tabs" />
                <Key k="⇧⌘C" label={copied ? "copied" : "copy url"} />
                <Key k="⌘W" label="close" />
            </div>
            {tabs.urls.map((url, i) => (
                <Webview
                    key={url}
                    ref={(el) => void (views.current[url] = el)}
                    src={url}
                    hidden={i !== tabs.active}
                    tabbed
                    onTitle={(title) => setTitles((m) => ({ ...m, [url]: title.replace(/ · GitHub$/, "") }))}
                />
            ))}
        </div>
    );
});
PrBrowser.displayName = "PrBrowser";

const BTN: React.CSSProperties = { background: "transparent", border: "none", color: T.muted, fontSize: 14, lineHeight: 1, cursor: "pointer", padding: "0 4px" };
