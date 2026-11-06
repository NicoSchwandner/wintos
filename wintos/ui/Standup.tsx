import { useEffect, useRef, useState } from "react";
import { itemsMarkdown, type ShownItem } from "../daemon/recap/standup";
import { lastDayName } from "./day";
import { focusList } from "./dayplan";
import { Key } from "./Key";
import { Md } from "./notes/Md";
import { MdEditor } from "./notes/MdEditor";
import { More } from "./notes/ProjectNotes";
import { standupAsks } from "./prs";
import { daemonFetch, useWintos } from "./useWintos";
import { ghPrs, type WintosState } from "./view";

type Recap = { date: string; items: ShownItem[] };

// For the daily: the last worked day as items the daemon proposes from where the time went, what
// the PRs did and the sessions' recaps; then what you need from the team and today's plan, both
// read now. Folded; m opens it. e edits the items as one markdown list, as you edit mine.md:
// delete a line to drop it, move it, rewrite it, add one.
export function Standup({ today, focus, panel }: { today: string; focus: string; panel: (p: { label: string; note?: string; keys?: React.ReactNode; children: React.ReactNode }) => React.ReactNode }) {
    const { state } = useWintos();
    const gh = state ? ghPrs(state) : undefined;
    const asks = gh ? standupAsks(gh.prs, gh.me, Date.now(), gh.team) : undefined;
    const plan = focusList(focus).filter((i) => !i.done).map((i) => i.text);
    const [recap, setRecap] = useState<Recap | null | undefined>();
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        let live = true;
        daemonFetch("/day/recap")
            .then((r) => (r.ok ? r.json() : null))
            .then((r) => live && setRecap(r), () => live && setRecap(null));
        return () => void (live = false);
    }, [today]);
    if (recap === null || (recap && !recap.items.length)) return null;
    // The page's list gets focus back, so its keys (e again, j/k) work at once.
    const close = () => (setEditing(false), ref.current?.closest<HTMLElement>("[data-zone=list]")?.focus());
    const save = (text: string) =>
        daemonFetch("/day/recap", { method: "PUT", body: { text } })
            .then((r) => (r.ok ? r.json() : undefined))
            .then((r: Recap | undefined) => (r ? (setRecap(r), setOpen(true), "ok" as const) : ("error" as const)), () => "error" as const);
    const label = recap ? `What you did ${lastDayName(recap.date, today).replace(/^(Yesterday|Last)/, (w) => w.toLowerCase())}` : "What you did";
    const dropped = recap ? recap.items.filter((i) => i.dropped).length : 0;
    // What you read is grouped by epic: each item's project named by the epic its sessions are
    // in, so the daily reads epic by epic. Editing still works on the items as they were written.
    const shown = recap && state ? byEpic(recap.items, state) : recap?.items;
    const read = recap && [itemsMarkdown(shown ?? []), asks && `- Asks: ${asks}`, plan.length > 0 && `- Today: ${plan.join("; ")}`].filter(Boolean).join("\n");
    const keys = editing ? (
        <>
            <Key k="⌘⏎" label="save: it writes like this next time" />
            <Key k="esc" label="discard" />
        </>
    ) : (
        <button type="button" data-edit-daily data-key="e" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => setEditing(true)} style={{ padding: 0, background: "transparent", border: "none", cursor: "pointer" }}>
            <Key k="e" label="edit" />
        </button>
    );
    return (
        <div ref={ref} style={{ display: "contents" }}>
            {panel({
                label,
                note: !recap ? "summarizing…" : dropped && !editing ? `${dropped} dropped` : undefined,
                keys: recap && keys,
                children: (
                    <>
                        {editing && recap && <MdEditor initial={itemsMarkdown(recap.items)} save={save} close={close} file="the daily" size="full" id="daily-editor" draftKey={`daily:${recap.date}`} />}
                        {!editing && open && read && (
                            <div data-wintos="standup">
                                <Md text={read} size="full" />
                            </div>
                        )}
                        {recap && !editing && <More open={open} label="Show it, for the daily" onClick={() => setOpen(!open)} />}
                    </>
                ),
            })}
        </div>
    );
}

// An item's project as its epic's short name, when that project's sessions are in one epic;
// items in the same epic then sit together, epics in the order they first come.
export function byEpic<I extends { project: string }>(items: I[], state: WintosState): I[] {
    const epicOfProject = (title: string) => {
        const tab = state.projects.find((p) => p.title === title)?.id;
        const ids = [...new Set(state.sessions.filter((x) => x.tabId === tab && x.epic).map((x) => x.epic!))];
        const e = ids.length === 1 ? state.epics?.find((x) => x.id === ids[0]) : undefined;
        return e ? (e.short ?? e.title) : undefined;
    };
    const named = items.map((i) => ({ ...i, project: epicOfProject(i.project) ?? i.project }));
    const order = [...new Set(named.map((i) => i.project))];
    return order.flatMap((p) => named.filter((i) => i.project === p));
}
