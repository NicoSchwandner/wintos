import { memo, useEffect, useRef, useState } from "react";
import type { Reentry } from "../daemon/sessions/reentry";
import { answerText, decisions, type Decision } from "./decisions";
import { focusSession } from "./focus";
import { Key } from "./Key";
import { runKey } from "./menu";
import { T } from "./tokens";
import { typeIntoPane } from "./typeIntoPane";
import { useFocusOnMount } from "./useFocusOnMount";
import { useNow } from "./useNow";
import { daemonFetch, parkBlock, useWintos } from "./useWintos";
import { relTime } from "./view";
import { useZoneKeys } from "./zones";

const KIND_WORD: Record<string, string> = { answer: "Answer", decide: "Decide", approve: "Approve", unblock: "Unblock" };
const BY_WORD: Record<string, string> = { session: "written by the session", tool: "asked with Claude's question", model: "read by WintOS from the turn", guess: "read by WintOS from the turn" };

// Toggles for a card's picks: a to i, without e (your own answer).
const PICK_KEYS = "abcdfghi";

// ⌥⌘O: the turns waiting on you, one card at a time, quick ones first. 1-4 answers with an
// option (one that can't be undone takes the same key twice), the number after them leaves it to
// the session's recommendation, e writes your own, a-i toggle its picks; WintOS types the answer
// into the session. ⏎ goes into the session, w parks it, s leaves it for the next batch.
export const DecisionsPage = memo(() => {
    const ref = useFocusOnMount<HTMLDivElement>();
    const { state } = useWintos();
    const now = useNow(30_000);
    // Decided or left for later in this sitting, by turn: the batch moves on while the session takes it up.
    const [done, setDone] = useState<Record<string, "answered" | "parked" | "later">>({});
    const [own, setOwn] = useState<string | null>(null);
    const [armed, setArmed] = useState<number | null>(null);
    const [picked, setPicked] = useState<boolean[]>([]);
    const [failed, setFailed] = useState<string | null>(null);
    const [back, setBack] = useState<Reentry | null>(null);
    const ownRef = useRef<HTMLTextAreaElement>(null);
    const title = (tabId: string) => state?.projects.find((p) => p.id === tabId)?.title ?? "Untitled";
    const all = state ? decisions(state, now, title) : [];
    const seen = useRef<Decision[]>([]);
    // A card stays in the batch once shown, so the count holds while answered ones start working.
    for (const d of all) if (!seen.current.some((x) => x.turn === d.turn)) seen.current.push(d);
    const batch = seen.current;
    const card = batch.find((d) => !done[d.turn] && all.some((x) => x.turn === d.turn));
    const at = card ? batch.indexOf(card) : batch.length;
    useEffect(() => void (own !== null && setTimeout(() => ownRef.current?.focus(), 0)), [own !== null]);
    useEffect(() => {
        setArmed(null), setFailed(null), setBack(null), setPicked(card?.picks?.map((p) => p.on) ?? []);
        // A card the session gave no context: what you asked it and what it did, as on a return.
        if (!card || card.context || card.why || card.options.length) return;
        let live = true;
        void daemonFetch(`/sessions/${encodeURIComponent(card.sessionId)}/reentry`)
            .then((r) => (r.ok ? (r.json() as Promise<Reentry>) : null))
            .then((r) => live && r && setBack(r))
            .catch(() => {});
        return () => void (live = false);
    }, [card?.turn]);
    const mark = (d: Decision, how: "answered" | "parked" | "later") => (setDone({ ...done, [d.turn]: how }), setOwn(null), ref.current?.focus());
    const answer = (d: Decision, a: Parameters<typeof answerText>[1]) => {
        const text = answerText(d, a, picked);
        if (!text) return;
        typeIntoPane(d.blockId, text).then(
            () => mark(d, "answered"),
            (e) => setFailed(`Not sent: the session's terminal didn't take it (${e instanceof Error ? e.message : String(e)}). ⏎ goes into it.`),
        );
    };
    // What can't be undone takes the same key twice.
    const pick = (d: Decision, n: number, a: Parameters<typeof answerText>[1]) => (d.final && armed !== n ? setArmed(n) : answer(d, a));
    const yourCall = card && card.recommend ? card.options.length + 1 : undefined;
    const keys: Record<string, () => void> = {};
    if (card && own === null) {
        card.options.forEach((_, i) => (keys[String(i + 1)] = () => pick(card, i + 1, { option: i + 1 })));
        if (yourCall) keys[String(yourCall)] = () => pick(card, yourCall, { yourCall: true });
        if (card.by !== "tool") keys.e = () => setOwn("");
        card.picks?.forEach((_, i) => (keys[PICK_KEYS[i]] = () => setPicked(picked.map((on, j) => (j === i ? !on : on)))));
        keys.Enter = () => focusSession({ tabId: card.tabId, blockId: card.blockId });
        keys.w = () => (void parkBlock(card.blockId), mark(card, "parked"));
        keys.s = () => (void daemonFetch("/rhythm/later", { method: "POST", body: { sessionId: card.sessionId, since: card.since } }).catch(() => {}), mark(card, "later"));
    } else if (!card && batch.length) keys.Enter = () => runKey("release");
    useZoneKeys(ref, keys);
    const send = () => card && own?.trim() && answer(card, { own });
    const opt = (n: number, label: string, then: string | undefined, recommended: boolean, onPick: () => void) => (
        <button key={n} type="button" data-key={String(n)} tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={onPick} style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: "13px 15px", borderRadius: 11, background: recommended ? T.cardActive : T.sidebar, border: `1px solid ${recommended ? T.apricot : "transparent"}`, cursor: "pointer", textAlign: "left", fontFamily: T.ui }}>
            <Key k={String(n)} label="" always />
            <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 15, color: T.emphasis }}>
                    {label}
                    {recommended && <span style={{ fontSize: 12, color: T.moss, marginLeft: 8 }}>recommended</span>}
                    {armed === n && <span style={{ fontSize: 12, color: T.brick, marginLeft: 8 }}>{n} again: it can't be undone</span>}
                </span>
                {then && <span style={{ fontSize: 13, color: T.muted }}>{then}</span>}
            </span>
        </button>
    );
    const section = (label: string, text: string | undefined, extra?: string) =>
        text && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: "0.06em", color: T.faint }}>{label}</span>
                <span style={{ fontSize: 14.5, lineHeight: 1.5, color: T.secondary }}>{text}</span>
                {extra && <span style={{ fontFamily: T.mono, fontSize: 12, color: T.faint }}>{extra}</span>}
            </div>
        );
    return (
        <div ref={ref} tabIndex={0} data-zone="list" data-wintos="decisions" style={{ flexGrow: 1, display: "flex", justifyContent: "center", padding: "30px 40px 18px", background: T.ground, outline: "none", fontFamily: T.ui, minWidth: 0, minHeight: 0, overflowY: "auto" }}>
            <div style={{ width: "100%", maxWidth: 820, display: "flex", flexDirection: "column", gap: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontFamily: T.display, fontSize: 30, color: T.emphasis }}>Decisions</span>
                    <span style={{ fontFamily: T.mono, fontSize: 12, color: T.muted }}>{card ? `${at + 1} of ${batch.length}` : batch.length ? `all ${batch.length} done` : ""}</span>
                </div>
                {batch.length > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: `repeat(${batch.length}, minmax(0, 1fr))`, gap: 4 }}>
                        {batch.map((d) => <span key={d.sessionId} style={{ height: 4, borderRadius: 2, background: d === card ? T.apricot : done[d.sessionId] || !all.some((x) => x.sessionId === d.sessionId) ? T.moss : T.borderActive }} />)}
                    </div>
                )}
                {!card ? (
                    <div data-wintos="decisions-empty" style={{ padding: "26px 30px", background: T.card, borderRadius: 16, fontSize: 15, color: T.secondary }}>
                        {batch.length ? "That was the batch: every turn has its answer, or waits for the next one. ⏎ takes you back." : "Nothing waits on you."}
                    </div>
                ) : (
                    <div data-wintos="decision-card" data-session={card.sessionId} style={{ background: T.card, borderRadius: 16, padding: "26px 30px", display: "flex", flexDirection: "column", gap: 18 }}>
                        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
                            <span style={{ padding: "3px 9px", borderRadius: 999, background: T.cardActive, color: T.apricot, fontWeight: 600 }}>{KIND_WORD[card.kind] ?? card.kind}</span>
                            <span style={{ padding: "3px 9px", borderRadius: 999, background: T.cardActive, color: card.final ? T.brick : T.moss }}>{card.final ? "can't be undone" : "can be undone"}</span>
                            <span style={{ marginLeft: "auto", color: T.faint }}>
                                {card.project} · {card.session} · waiting {relTime(now - card.since)} · <span style={{ fontFamily: T.mono }}>{BY_WORD[card.by] ?? card.by}</span>
                            </span>
                        </div>
                        <span style={{ fontSize: 22, lineHeight: 1.35, fontWeight: 600, color: T.emphasis }}>{card.question}</span>
                        {section("CONTEXT", card.context)}
                        {back && section("YOU ASKED", back.asked)}
                        {back && section("IT DID", back.did)}
                        {section("WHY IT ASKS", card.why, card.facts)}
                        {!card.why && card.facts && <span style={{ fontFamily: T.mono, fontSize: 12, color: T.faint }}>{card.facts}</span>}
                        {card.picks && (
                            <div data-wintos="decision-picks" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: "0.06em", color: T.faint }}>WHICH TO KEEP</span>
                                {card.picks.map((p, i) => (
                                    <button key={i} type="button" data-key={PICK_KEYS[i]} data-on={picked[i] ? "1" : "0"} tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => setPicked(picked.map((on, j) => (j === i ? !on : on)))} style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "6px 4px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left", fontFamily: T.ui, fontSize: 14, color: picked[i] ? T.emphasis : T.faint }}>
                                        <Key k={PICK_KEYS[i]} label="" always />
                                        <span style={{ fontFamily: T.mono, color: picked[i] ? T.moss : T.faint }}>{picked[i] ? "[x]" : "[ ]"}</span>
                                        <span style={{ textDecoration: picked[i] ? "none" : "line-through" }}>{p.label}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                        {card.options.length > 0 && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                {card.options.map((o, i) => opt(i + 1, o.label, o.then, card.recommend === i + 1, () => pick(card, i + 1, { option: i + 1 })))}
                                {yourCall && opt(yourCall, "Your call", "Go with the session's recommendation.", false, () => pick(card, yourCall, { yourCall: true }))}
                            </div>
                        )}
                        {failed && <span data-wintos="decision-failed" style={{ fontSize: 13, color: T.brick }}>{failed}</span>}
                        {own !== null && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: "0.06em", color: T.apricot }}>YOUR OWN</span>
                                <textarea
                                    ref={ownRef}
                                    data-zone="overlay"
                                    data-wintos="decision-own"
                                    value={own}
                                    rows={3}
                                    onChange={(e) => setOwn(e.target.value)}
                                    onKeyDown={(e) => {
                                        e.stopPropagation();
                                        if (e.key === "Enter" && e.metaKey) (e.preventDefault(), send());
                                        if (e.key === "Escape") (e.preventDefault(), setOwn(null), ref.current?.focus());
                                    }}
                                    style={{ resize: "vertical", padding: "12px 14px", borderRadius: 11, background: T.terminal, border: `1px solid ${T.borderActive}`, outline: "none", color: T.text, fontFamily: T.mono, fontSize: 13.5, lineHeight: 1.6 }}
                                />
                                <span style={{ fontSize: 12, color: T.faint }}>Typed into the session as your reply.</span>
                            </div>
                        )}
                    </div>
                )}
                <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 12.5, color: T.muted, padding: "0 4px" }}>
                    {own !== null ? (
                        <>
                            <Key k="⌘⏎" label="send it" always />
                            <Key k="esc" label="back to the options" always />
                        </>
                    ) : (
                        card && (
                            <>
                                {card.options.length > 0 && <Key k={`1–${yourCall ?? card.options.length}`} label="answer" always />}
                                {card.by !== "tool" && <Key k="e" label="your own" always />}
                                {card.picks && <Key k={`a–${PICK_KEYS[card.picks.length - 1]}`} label="keep or leave out" always />}
                                <Key k="⏎" label="into the session" always />
                                <Key k="w" label="park it" always />
                                <Key k="s" label="next batch" always />
                            </>
                        )
                    )}
                    <span style={{ marginLeft: "auto" }}>
                        <button type="button" data-key="esc" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => runKey("release")} style={{ padding: 0, background: "transparent", border: "none", cursor: "pointer" }}>
                            <Key k="esc" label="close" always />
                        </button>
                    </span>
                </div>
            </div>
        </div>
    );
});
DecisionsPage.displayName = "DecisionsPage";
