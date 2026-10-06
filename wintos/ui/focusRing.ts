import { getApi } from "@/store/global";
import { zoneOf } from "./zones";

// One green frame, where the keys go: Wave's frame on the focused pane (even when it is the only
// one), the same colour around a focused list or the notes, and on a field being typed in
// (mine.md, a rename). Wave frames the layout's focused
// node even while focus is elsewhere; here the frame follows the DOM focus instead. While another
// app has the keys (the window is not focused), there is no frame at all: "away".
const CSS = `
:root[data-wintos-focus="pane"] .block.block-focused .block-mask { border-color: var(--accent-color) !important; }
:root:not([data-wintos-focus="pane"]) .block.block-focused .block-mask { border-color: transparent !important; }
:root[data-wintos-focus="list"] [data-zone="list"]:focus-within { box-shadow: inset 0 0 0 2px var(--accent-color); }
:root[data-wintos-focus="overlay"] :is(textarea, input)[data-zone="overlay"]:focus { outline: 2px solid var(--accent-color) !important; outline-offset: -2px; }
:root:not([data-wintos-focus="away"]) [data-zone="list"]:focus-within [data-cursor] { outline: 1px solid var(--accent-color); outline-offset: 2px; border-radius: 4px; }
`;

export function installFocusRing(): void {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.append(style);
    // After focusout the new target is not active yet; read it once the move has settled.
    let windowFocused = true;
    const mark = () => setTimeout(() => (document.documentElement.dataset.wintosFocus = windowFocused ? zoneOf(document.activeElement) : "away"), 0);
    document.addEventListener("focusin", mark, true);
    document.addEventListener("focusout", mark, true);
    getApi().onWintosWindowFocus?.((focused) => ((windowFocused = focused), mark()));
    mark();
}
