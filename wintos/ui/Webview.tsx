import { getApi } from "@/store/global";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

// tabbed: links the page opens elsewhere become tabs of the view (emain/emain-wintos-webview.ts).
type Props = { src: string; hidden?: boolean; tabbed?: boolean; onTitle?: (title: string) => void };

// A <webview> for WintOS views. Registering focus the way Wave's web blocks do makes emain
// forward global keys out of the page (⌘ keys, esc back to the view), which it only does for
// the webview it was told has focus. Absolutely sized: a flex-grown webview reported the page a
// taller viewport than it showed, cutting off the bottom and popovers placed near it.
export const Webview = forwardRef<Electron.WebviewTag | null, Props>(({ src, hidden, tabbed, onTitle }, outer) => {
    const ref = useRef<Electron.WebviewTag | null>(null);
    const handlers = useRef({ onTitle });
    handlers.current = { onTitle };
    useImperativeHandle(outer, () => ref.current!, []);
    useEffect(() => {
        const wv = ref.current;
        if (!wv) return;
        const on: [string, (e: any) => void][] = [
            ["focus", () => getApi().setWebviewFocus(wv.getWebContentsId())],
            ["blur", () => getApi().setWebviewFocus(null)],
            ["dom-ready", () => {
                wv.dataset.webcontentsid = String(wv.getWebContentsId());
                if (tabbed) getApi().registerWintosWebview(wv.getWebContentsId());
            }],
            ["page-title-updated", (e) => handlers.current.onTitle?.(e.title)],
        ];
        for (const [name, f] of on) wv.addEventListener(name, f);
        return () => on.forEach(([name, f]) => wv.removeEventListener(name, f));
    }, []);
    return (
        <div style={{ flexGrow: 1, position: "relative", minHeight: 0, display: hidden ? "none" : undefined }}>
            {/* The default session, like Wave's web blocks, so logins are shared. */}
            <webview ref={ref as unknown as React.Ref<HTMLElement>} src={src} data-active={hidden ? undefined : ""} style={{ position: "absolute", inset: 0 }} />
        </div>
    );
});
Webview.displayName = "Webview";
