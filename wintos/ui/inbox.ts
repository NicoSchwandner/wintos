import { globalStore } from "@/app/store/jotaiStore";
import { getWaveObjectAtom, makeORef } from "@/app/store/wos";
import { atoms, getApi } from "@/store/global";
import { inboxListAtom, type InboxList } from "./notes/state";
import { inboxTabId } from "./view";

// ⇧⌘G / ⇧⌘O from a project: switch to the Inbox tab on that list. The Inbox is another
// renderer, so the list travels in localStorage, which all renderers share.
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

const focusList = () => requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-wintos=inbox-list]")?.focus());

export function goToInbox(list: InboxList): void {
    const ids = globalStore.get(atoms.workspace)?.tabids ?? [];
    const tabs = Object.fromEntries(ids.map((id) => [id, globalStore.get(getWaveObjectAtom<Tab>(makeORef("tab", id)))]));
    const inbox = inboxTabId(ids, tabs);
    if (!inbox) return;
    if (inbox === globalStore.get(atoms.staticTabId)) return void (globalStore.set(inboxListAtom, list), focusList());
    localStorage.setItem(KEY, inboxHandoff(list, Date.now()));
    getApi().setActiveTab(inbox);
}

// In the Inbox's renderer, on mount and whenever it becomes visible.
export function takeInboxHandoff(): void {
    const list = readInboxHandoff(localStorage.getItem(KEY), Date.now());
    if (!list) return;
    localStorage.removeItem(KEY);
    globalStore.set(inboxListAtom, list);
    focusList();
}
