import { globalStore } from "@/app/store/jotaiStore";
import { getWaveObjectAtom, makeORef } from "@/app/store/wos";
import { atoms, getApi } from "@/store/global";

// A focus trail in waveapp.log (lines "wintos-focus [tab] …", ms timestamps): every focus move
// with its cause, every WintOS key and action, every automatic move Wave or a page tried. Enough to
// answer "I expected focus there" from the log alone. Keys typed into a terminal or a text field
// are never logged; only chords, named keys (Esc, ⏎, arrows) and a list's own letters.
export function flog(msg: string): void {
    try {
        const tab = globalStore.get(getWaveObjectAtom<Tab>(makeORef("tab", globalStore.get(atoms.staticTabId))));
        getApi().sendLog(`wintos-focus [${tab?.name ?? "?"}] ${msg}`);
    } catch {} // the trail must never break what it watches
}

function pageLabel(src: string | null): string {
    try {
        const u = new URL(src ?? "");
        return (u.hostname + u.pathname).slice(0, 60);
    } catch {
        return "page";
    }
}

// What an element is, in words: "terminal 1a2b3c", "page github.com/… 4d5e6f", "inbox-list".
export function where(el: Element | null): string {
    if (!el || el === document.body) return "nothing";
    const h = el as HTMLElement;
    const block = h.closest?.("[data-blockid]")?.getAttribute("data-blockid")?.slice(0, 6);
    if (h.tagName === "WEBVIEW") return `page ${pageLabel(h.getAttribute("src"))} ${block ?? ""}`.trim();
    if (h.classList?.contains("xterm-helper-textarea")) return `terminal ${block ?? ""}`.trim();
    const name = h.dataset?.wintos ?? h.closest?.("[data-wintos]")?.getAttribute("data-wintos") ?? h.tagName.toLowerCase();
    return block ? `${name} ${block}` : name;
}
