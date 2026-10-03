import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";
import { daemonFetch } from "./useWintos";

// The keyboard game's window side: a WintOS action done by key is reported as a key, a click on
// an element marked with data-key (something that has a shortcut) as a slip. Clicks inside a page
// never reach this document, and elements without a key aren't marked, so neither counts.

type KeyEvent = { key: string; code?: string; cmd?: boolean; shift?: boolean; option?: boolean; alt?: boolean; control?: boolean; repeat?: boolean };

// How a key reads in WintOS's hints: ⌥⌘J by its position (⌥ turns J into ∆ on a Mac), ⌘J upper
// case, a list's own j lower case.
export function keyName(e: KeyEvent): string {
    const mods = (e.control ? "⌃" : "") + (e.alt || e.option ? "⌥" : "") + (e.shift ? "⇧" : "") + (e.cmd ? "⌘" : "");
    const letter = /^Key([A-Z])$/.exec(e.code ?? "")?.[1] ?? (/^[a-z]$/i.test(e.key) ? e.key.toUpperCase() : undefined);
    const named = { Escape: "Esc", Enter: "⏎", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Tab: "⇥" }[e.key];
    const name = letter ? (mods ? letter : letter.toLowerCase()) : (named ?? e.key);
    return mods + name;
}

const report = (kind: "key" | "click", key: string) => void daemonFetch("/keyboard", { method: "POST", body: { kind, key } }).catch(() => undefined);

export function reportKey(e: KeyEvent): void {
    if (e.repeat || ["Meta", "Shift", "Control", "Alt"].includes(e.key)) return;
    report("key", keyName(e));
}

// What the sidebar's footer line says for a while: a slip, or a new badge.
export type Notice = { kind: "slip"; key: string; streak: number; at: number } | { kind: "badge"; key: string; tier: string; at: number };
export const noticeAtom = atom(null as Notice | null);
// A notice stays at least this long, then goes with the next key press (or at once, if a key was
// pressed meanwhile): long enough to be read after the click, gone once you're back on the keys.
export const NOTICE_MIN_MS = 20_000;

let lastKeyAt = 0;
let waitingForKey = false;
let streak = 0;
export const setLatestStreak = (n: number) => (streak = n);

export function showNotice(n: Notice): void {
    globalStore.set(noticeAtom, n);
    waitingForKey = false;
    setTimeout(() => {
        if (globalStore.get(noticeAtom) !== n) return;
        if (lastKeyAt > n.at) globalStore.set(noticeAtom, null);
        else waitingForKey = true;
    }, NOTICE_MIN_MS);
}

let installed = false;
export function installKeyGame(): void {
    if (installed) return;
    installed = true;
    window.addEventListener(
        "keydown",
        (e) => {
            lastKeyAt = Date.now();
            if (waitingForKey) (globalStore.set(noticeAtom, null), (waitingForKey = false));
        },
        true
    );
    document.addEventListener(
        "click",
        (e) => {
            const el = (e.target as Element | null)?.closest?.<HTMLElement>("[data-key]");
            const key = el?.dataset.key;
            if (!el || !key) return;
            report("click", key);
            showNotice({ kind: "slip", key, streak, at: Date.now() });
            el.animate([{ boxShadow: "0 0 0 2px #fe8019aa" }, { boxShadow: "0 0 0 2px #fe801900" }], { duration: 3000 });
        },
        true
    );
}
