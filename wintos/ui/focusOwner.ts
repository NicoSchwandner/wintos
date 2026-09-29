import { flog, where } from "./focusLog";
import { zoneOf, type Zone } from "./zones";

// The one owner of where focus should be. Wave's rule is that its layout's focused pane holds
// focus, so it pulls focus into a pane whenever that pane changes (magnify, open, close, a tab
// shown); WintOS also puts focus outside the layout (the Inbox list, the notes, an overlay).
// The intent below says which wins: it is set by every focus you or WintOS cause, and Wave's
// automatic moves (block.tsx, globalRefocus) ask it before they take focus into a pane.
let intent: { zone: Zone; el: HTMLElement | null } = { zone: "pane", el: null };

export const paneWanted = () => intent.zone === "pane";

// Wave's block effect asking to take focus into a pane that just became the layout's focused one.
export function mayFocusPane(blockId: string): boolean {
    if (paneWanted()) return true;
    flog(`wave wanted focus in pane ${blockId.slice(0, 6)}: kept on ${where(intent.el)} (intent ${intent.zone})`);
    return false;
}

// WintOS moving focus into a pane on purpose (Esc to the panes, ⌘1/⌘2, ⌥⌘←/→, landing on a session).
export function wantPane(why = "wintos"): void {
    if (intent.zone !== "pane") flog(`intent → pane (${why})`);
    intent = { zone: "pane", el: null };
}

// Back where focus should be, when something else took or dropped it. A pane is Wave's to focus.
export function restoreFocus(why: string): boolean {
    if (intent.zone === "pane") return false;
    const el = intent.el?.isConnected ? intent.el : document.querySelector<HTMLElement>(`[data-zone="${intent.zone}"]`);
    flog(`restore (${why}) → ${where(el)}${el ? "" : ": nothing to focus"}`);
    el?.focus();
    return true;
}

let pagePressedAt = 0;

export function installFocusOwner(): void {
    document.addEventListener("visibilitychange", () => flog(document.visibilityState === "visible" ? "tab shown" : "tab hidden"));
    // Anything focused in this document is a move you or WintOS made (Wave's own are gated).
    document.addEventListener(
        "focusin",
        (e) => {
            const el = e.target as HTMLElement;
            if (el.tagName === "WEBVIEW") return;
            intent = { zone: zoneOf(el), el: zoneOf(el) === "pane" ? null : el };
            flog(`focus → ${where(el)} (intent ${intent.zone})`);
        },
        true
    );
    // A page taking focus: yours if a pane is wanted or you just pressed the mouse in it; else the
    // page did it by itself (it loaded, a sign-in autofocused a field), and focus goes back.
    document.addEventListener(
        "focus",
        (e) => {
            const page = e.target as HTMLElement;
            if (page.tagName !== "WEBVIEW") return;
            const pressed = Date.now() - pagePressedAt < 1000;
            if (paneWanted() || pressed) {
                flog(`focus → ${where(page)} (${pressed ? "you clicked it" : "a pane was wanted"})`);
                return wantPane(pressed ? "click in page" : "wintos");
            }
            flog(`${where(page)} took focus by itself (a load, an autofocus): putting it back`);
            setTimeout(() => restoreFocus("page grabbed focus"), 0);
        },
        true
    );
    // The page reports a press (preload-webview.ts); it can arrive after the focus it caused.
    document.addEventListener(
        "ipc-message",
        (e) => {
            const ev = e as Event & { channel?: string };
            if (ev.channel !== "wintos-page-pressed") return;
            pagePressedAt = Date.now();
            const page = e.target as HTMLElement;
            flog(`mouse pressed in ${where(page)}`);
            wantPane("click in page");
            if (document.activeElement !== page) page.focus();
        },
        true
    );
    // Focus never rests on nothing: an element that held it went away (a relayout, an overlay
    // closing, the Inbox's last page closed), so it goes back where it should be, else to the
    // Inbox list.
    document.addEventListener(
        "focusout",
        () =>
            setTimeout(() => {
                if (document.activeElement !== document.body) return;
                flog("focus lost to nothing");
                if (!restoreFocus("focus lost")) document.querySelector<HTMLElement>("[data-wintos=inbox-list]")?.focus();
            }, 0),
        true
    );
}
