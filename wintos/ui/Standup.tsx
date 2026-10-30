import { useEffect, useRef, useState } from "react";
import { asText, detailsMarkdown, type ShownItem } from "../daemon/recap/standup";
import { lastDayName } from "./day";
import { focusList } from "./dayplan";
import { startCursor } from "./itemCursor";
import { Key } from "./Key";
import { Md } from "./notes/Md";
import { More, Rich } from "./notes/ProjectNotes";
import { standupAsks } from "./prs";
import { T } from "./tokens";
import { daemonFetch, useWintos } from "./useWintos";
import { ghPrs } from "./view";

type Recap = { date: string; items: ShownItem[] };

// For the daily: the last worked day as items the daemon proposes from where the time went, what
// the PRs did and the sessions' recaps; then what you need from the team and today's plan, both
// read now. Folded; m opens it. e curates: x drops an item (greyed here, gone when you read it
// out), p lifts it to the top, ⏎ rewrites it.
export function Standup({ today, focus, panel }: { today: string; focus: string; panel: (p: { label: string; note?: string; keys?: React.ReactNode; children: React.ReactNode }) => React.ReactNode }) {
    const { state } = useWintos();
    const gh = state ? ghPrs(state) : undefined;
    const asks = gh ? standupAsks(gh.prs, gh.me, Date.now(), gh.team) : undefined;
    const plan = focusList(focus).filter((i) => !i.done).map((i) => i.text);
    const [recap, setRecap] = useState<Recap | null | undefined>();
    const [open, setOpen] = useState(false);
    const [curating, setCurating] = useState(false);
    const [rewriting, setRewriting] = useState<string | undefined>();
    // The item last changed: lifting one reorders the list, and the cursor goes with it.
    const [follow, setFollow] = useState<string | undefined>();
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        let live = true;
        daemonFetch("/day/recap")
            .then((r) => (r.ok ? r.json() : null))
            .then((r) => live && setRecap(r), () => live && setRecap(null));
        return () => void (live = false);
    }, [today]);
    // Curating starts on the first item, so e x drops it.
    useEffect(() => {
        const zone = ref.current?.closest<HTMLElement>("[data-zone]");
        if (curating && zone) requestAnimationFrame(() => startCursor(zone, (el) => el.dataset.item === "standup" && (!follow || el.dataset.standup === follow)));
    }, [curating, recap]);
    if (recap === null || (recap && !recap.items.length)) return null;
    const change = (id: string, body: { drop?: boolean; top?: boolean; text?: string }) =>
        void (setFollow(id), daemonFetch(`/day/recap/${encodeURIComponent(id)}`, { method: "POST", body })
            .then((r) => (r.ok ? r.json() : undefined))
            .then((r: Recap | undefined) => r && setRecap(r))
            .catch(() => {}));
    const label = recap ? `What you did ${lastDayName(recap.date, today).replace(/^(Yesterday|Last)/, (w) => w.toLowerCase())}` : "What you did";
    const shown = recap ? (curating ? recap.items : recap.items.filter((i) => !i.dropped)) : [];
    const dropped = recap ? recap.items.length - recap.items.filter((i) => !i.dropped).length : 0;
    const toggleCurate = () => (setCurating(!curating), setRewriting(undefined), setFollow(undefined), !curating && setOpen(true));
    const keys = (
        <>
            {curating && <Key k="j k · x p ⏎" label="drop · top · rewrite" />}
            <button type="button" data-curate data-key="e" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={toggleCurate} style={{ padding: 0, background: "transparent", border: "none", cursor: "pointer" }}>
                <Key k="e" label={curating ? "done" : "curate"} />
            </button>
        </>
    );
    return (
        <div ref={ref} style={{ display: "contents" }}>
            {panel({
                label,
                note: !recap ? "summarizing…" : dropped && !curating ? `${dropped} dropped` : undefined,
                keys: recap && keys,
                children: (
                    <>
                        {(open || curating) && recap && (
                            <ul style={{ margin: 0, paddingLeft: 18, listStyle: "disc", display: "flex", flexDirection: "column", gap: 4, fontSize: 13, lineHeight: 1.5, color: T.secondary }}>
                                {shown.map((i) => (
                                    <StandupRow key={i.id} item={i} curating={curating} rewriting={rewriting === i.id} onRewrite={(on) => setRewriting(on ? i.id : undefined)} change={(body) => change(i.id, body)} />
                                ))}
                                {asks && <li data-wintos="standup-asks"><Rich text={`Asks: ${asks}`} size="full" /></li>}
                                {plan.length > 0 && <li data-wintos="standup-today"><Rich text={`Today: ${plan.join("; ")}`} size="full" /></li>}
                            </ul>
                        )}
                        {recap && !curating && <More open={open} label="Show it, for the daily" onClick={() => setOpen(!open)} />}
                    </>
                ),
            })}
        </div>
    );
}

const ACT: React.CSSProperties = { display: "none" };

function StandupRow({ item, curating, rewriting, onRewrite, change }: { item: ShownItem; curating: boolean; rewriting: boolean; onRewrite: (on: boolean) => void; change: (body: { drop?: boolean; top?: boolean; text?: string }) => void }) {
    const [text, setText] = useState("");
    if (rewriting)
        return (
            <li data-wintos="standup-rewrite" style={{ listStyle: "none", marginLeft: -18 }}>
                <textarea
                    autoFocus
                    value={text}
                    rows={Math.max(2, text.split("\n").length)}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter" && e.metaKey) e.preventDefault(), change({ text }), onRewrite(false);
                        if (e.key === "Escape") e.preventDefault(), onRewrite(false);
                    }}
                    style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", background: T.card, border: `1px solid ${T.borderActive}`, borderRadius: 8, outline: "none", color: T.text, fontFamily: T.mono, fontSize: 12.5, lineHeight: 1.5, resize: "vertical" }}
                />
                <span style={{ display: "flex", gap: 14, fontSize: 11, color: T.muted }}>
                    <Key k="⌘⏎" label="save: it writes like this next time" />
                    <Key k="esc" label="keep it" />
                </span>
            </li>
        );
    return (
        <li data-item={curating ? "standup" : undefined} data-standup={item.id} data-wintos="standup-item" data-dropped={item.dropped || undefined} style={{ opacity: curating && item.dropped ? 0.4 : 1, borderRadius: 6 }}>
            <Rich text={item.text} size="full" />
            {curating && item.top && <span style={{ marginLeft: 8, fontFamily: T.mono, fontSize: 10.5, color: T.moss }}>top</span>}
            {item.details.length > 0 && <Md text={detailsMarkdown(item.details)} size="full" />}
            {curating && (
                <>
                    <button type="button" data-drop tabIndex={-1} style={ACT} onClick={() => change({ drop: !item.dropped })} />
                    <button type="button" data-top tabIndex={-1} style={ACT} onClick={() => change({ top: !item.top })} />
                    <button type="button" data-rewrite tabIndex={-1} style={ACT} onClick={() => (setText(asText(item.text, item.details)), onRewrite(true))} />
                </>
            )}
        </li>
    );
}
