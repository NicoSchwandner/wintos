import { getApi } from "@/store/global";
import { zoneOf } from "./zones";

// One green frame, where the keys go: Wave's frame on the focused pane (even when it is the only
// one), the same colour around a focused list or the notes, and on a field being typed in
// (mine.md, a rename). Wave frames the layout's focused
// node even while focus is elsewhere; here the frame follows the DOM focus instead. While another
// app has the keys (the window is not focused), there is no frame at all: "away".
// In mouse mode (data-wintos-input, see inputAfter) no frame marks where the keys go: someone
// clicking their way around reads it as noise. A field being typed in keeps its frame.
const KEYS = `:not([data-wintos-input="mouse"])`;
const CSS = `
:root[data-wintos-focus="pane"]${KEYS} .block.block-focused .block-mask { border-color: var(--accent-color) !important; }
:root:not([data-wintos-focus="pane"]) .block.block-focused .block-mask, :root[data-wintos-input="mouse"] .block.block-focused .block-mask { border-color: transparent !important; }
:root[data-wintos-focus="list"]${KEYS} [data-zone="list"]:focus-within { box-shadow: inset 0 0 0 2px var(--accent-color); }
:root[data-wintos-focus="overlay"] :is(textarea, input)[data-zone="overlay"]:focus { outline: 2px solid var(--accent-color) !important; outline-offset: -2px; }
:root:not([data-wintos-focus="away"])${KEYS} [data-zone="list"]:focus-within [data-cursor] { outline: 1px solid var(--accent-color); outline-offset: 2px; border-radius: 4px; }
`;

// Mouse or keyboard, from what you just did. A click on WintOS's own interface (sidebar, cards,
// notes, the pane strip and headers) is the mouse; a click inside a pane (a terminal, a page) and
// scrolling change nothing, as keyboard work does those too. A shortcut is the keyboard, and so is
// a key outside a text field (j in a list, Esc); typing is neither.
export type InputEvent = { kind: "pointer"; inPane: boolean } | { kind: "key"; key: string; mods: boolean; typing: boolean };
export function inputAfter(e: InputEvent): "mouse" | "keyboard" | undefined {
    if (e.kind === "pointer") return e.inPane ? undefined : "mouse";
    if (["Meta", "Alt", "Control", "Shift"].includes(e.key)) return undefined;
    return e.mods || !e.typing ? "keyboard" : undefined;
}
export const usingMouse = () => document.documentElement.dataset.wintosInput === "mouse";

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
    const set = (mode: "mouse" | "keyboard" | undefined) => mode && (document.documentElement.dataset.wintosInput = mode);
    document.addEventListener("pointerdown", (e) => set(inputAfter({ kind: "pointer", inPane: !!(e.target as Element | null)?.closest?.(".block-content") })), true);
    window.addEventListener(
        "keydown",
        (e) => {
            const t = e.target as Element | null;
            const typing = !!t?.closest?.("input, textarea, [contenteditable], .xterm");
            set(inputAfter({ kind: "key", key: e.key, mods: e.metaKey || e.ctrlKey || e.altKey, typing }));
        },
        true
    );
}
