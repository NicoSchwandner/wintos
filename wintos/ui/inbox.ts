import { globalStore } from "@/app/store/jotaiStore";
import { getWaveObjectAtom, makeORef } from "@/app/store/wos";
import { atoms, getApi } from "@/store/global";
import { inboxTabId, type InboxList } from "./view";

// ⇧⌘G / ⇧⌘O: switch to the PRs or the On call tab, its list focused. That tab is another
// renderer, so the request travels in localStorage, which all renderers share.
const KEY = "wintos:inbox";
const TTL_MS = 5000;
const LISTS: InboxList[] = ["prs", "oncall"];

export const inboxHandoff = (list: InboxList, at: number) => JSON.stringify({ list, at });

export function readInboxHandoff(raw: string | null, now: number): InboxList | undefined {
    try {
        const { list, at } = JSON.parse(raw ?? "null") ?? {};
        return LISTS.includes(list) && now - at < TTL_MS ? list : undefined;
    } catch {
        return undefined;
    }
}

const focusList = () => void requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-wintos=inbox-list]")?.focus());

export function goToInbox(list: InboxList): void {
    const ids = globalStore.get(atoms.workspace)?.tabids ?? [];
    const tabs = Object.fromEntries(ids.map((id) => [id, globalStore.get(getWaveObjectAtom<Tab>(makeORef("tab", id)))]));
    const inbox = inboxTabId(ids, tabs, list);
    if (!inbox) return;
    const here = globalStore.get(atoms.staticTabId);
    if (inbox === here) return focusList();
    // Remembered for the key pressed again: back to the project you came from.
    if (!LISTS.some((l) => inboxTabId(ids, tabs, l) === here)) localStorage.setItem(BACK, here);
    localStorage.setItem(KEY, inboxHandoff(list, Date.now()));
    getApi().setActiveTab(inbox);
}

// ⇧⌘G / ⇧⌘O as a toggle, like ⇧⌘L and ⇧⌘Y: pressed in that list's tab, back where you came from.
// Only the key toggles; a click on a card always opens.
const BACK = "wintos:before-inbox";
export function toggleInbox(list: InboxList): void {
    const ids = globalStore.get(atoms.workspace)?.tabids ?? [];
    const tabs = Object.fromEntries(ids.map((id) => [id, globalStore.get(getWaveObjectAtom<Tab>(makeORef("tab", id)))]));
    const back = localStorage.getItem(BACK);
    if (inboxTabId(ids, tabs, list) === globalStore.get(atoms.staticTabId) && back && ids.includes(back)) return getApi().setActiveTab(back);
    goToInbox(list);
}

// In an Inbox tab's renderer, on mount and whenever it becomes visible; only the tab of that
// list takes it, so the other one (or another window's) leaves it alone.
export function takeInboxHandoff(mine: InboxList): void {
    if (readInboxHandoff(localStorage.getItem(KEY), Date.now()) !== mine) return;
    localStorage.removeItem(KEY);
    focusList();
}
