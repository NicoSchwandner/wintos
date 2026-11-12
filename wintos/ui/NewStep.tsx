import { globalStore } from "@/app/store/jotaiStore";
import { memo, useState, useRef } from "react";
import { newStepEpicAtom } from "./notes/state";
import { EpicAvatar } from "./EpicAvatar";
import { lookOf, NO_EPIC } from "./epicLook";
import { closeOverlay, focusedSession } from "./focus";
import { Key } from "./Key";
import { runAction } from "./menu";
import { offerStep } from "./newproject";
import { T } from "./tokens";
import { useFocusOnMount } from "./useFocusOnMount";
import { useZoneKeys } from "./zones";
import { useWintos } from "./useWintos";

// ⌘N: a new session in a view of its own, with the epic it is a step of and what the step is,
// chosen before it starts. The first prompt is written in the terminal as usual, however long.
// ⌘1-9 pick the epic (the focused session's is marked), ⌘0 none; ↓ takes the epic's next planned step.
export const NewStep = memo(() => {
    const ref = useFocusOnMount<HTMLInputElement>();
    // A zone like the palette's: while you type in the sheet, no global key (⌘J, ⌘T, ⌃⇥) acts behind it.
    const sheetRef = useRef<HTMLDivElement>(null);
    useZoneKeys(sheetRef, {});
    const { state } = useWintos();
    const open = (state?.epics ?? []).filter((e) => !e.done);
    const [epic, setEpic] = useState<string | undefined>(() => {
        const asked = globalStore.get(newStepEpicAtom);
        globalStore.set(newStepEpicAtom, "");
        return open.find((e) => e.id === (asked || focusedSession()?.epic))?.id;
    });
    const [step, setStep] = useState("");
    const planned = open.find((e) => e.id === epic)?.steps.filter((x) => x.state !== "done").map((x) => x.name) ?? [];
    const start = () => {
        // Empty, it takes what the field shows: the epic's next planned step.
        const name = step.trim() || planned[0] || "";
        offerStep({ epic, step: name || undefined, unit: planned.includes(name) ? name : undefined });
        closeOverlay();
        void runAction("project");
    };
    return (
        <div style={{ position: "absolute", inset: 0, zIndex: 100, background: `color-mix(in srgb, ${T.ground} 70%, transparent)`, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "14vh" }} onClick={closeOverlay}>
            <div data-wintos="new-step" ref={sheetRef} data-zone="overlay" onClick={(e) => e.stopPropagation()} style={{ width: "min(540px, calc(100% - 32px))", padding: "18px 22px", background: T.ground, border: `1px solid ${T.borderActive}`, borderRadius: 12, fontFamily: T.ui, display: "flex", flexDirection: "column", gap: 12 }}>
                <span style={{ fontFamily: T.display, fontSize: 22, color: T.emphasis }}>New session</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {open.map((e, i) => (
                        <button
                            key={e.id}
                            type="button"
                            data-epic={e.id}
                            data-key={i < 9 ? `⌘${i + 1}` : undefined}
                            data-on={epic === e.id || undefined}
                            tabIndex={-1}
                            onMouseDown={(ev) => ev.preventDefault()}
                            onClick={() => setEpic(e.id)}
                            style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 8, border: "none", cursor: "pointer", textAlign: "left", background: epic === e.id ? T.cardActive : "transparent", boxShadow: epic === e.id ? `inset 0 0 0 1px ${lookOf(e).ring}` : "none", color: T.text, fontFamily: T.ui, fontSize: 13.5 }}
                        >
                            <span style={{ width: 22, fontFamily: T.mono, fontSize: 11.5, color: T.muted }}>{i < 9 ? `⌘${i + 1}` : ""}</span>
                            <EpicAvatar look={lookOf(e)} size={22} />
                            <span style={{ flexGrow: 1 }}>{e.title}</span>
                        </button>
                    ))}
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", color: epic ? T.muted : T.secondary }}>
                        <span style={{ width: 22, fontFamily: T.mono, fontSize: 11.5 }}>⌘0</span>
                        <EpicAvatar look={NO_EPIC} size={22} />
                        <span>{open.length ? "No epic" : "No epics yet: ⌥⌘E in a session starts one"}</span>
                    </div>
                </div>
                <label htmlFor="new-step-name" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ fontSize: 12, color: T.muted }}>What it is for, a few words</span>
                    <input
                        id="new-step-name"
                        ref={ref}
                        value={step}
                        maxLength={60}
                        placeholder={planned[0] ?? "left blank, it takes the name the session gives itself"}
                        onChange={(e) => setStep(e.target.value)}
                        onKeyDown={(e) => {
                            const digit = e.metaKey && /^Digit\d$/.test(e.code) ? Number(e.code.slice(5)) : undefined;
                            if (digit === 0) return e.preventDefault(), setEpic(undefined);
                            if (digit !== undefined && open[digit - 1]) return e.preventDefault(), setEpic(open[digit - 1].id);
                            if (e.key === "ArrowDown" && planned.length) e.preventDefault(), setStep(planned[(planned.indexOf(step) + 1) % planned.length]);
                            if (e.key === "Enter") e.preventDefault(), start();
                            if (e.key === "Escape") e.preventDefault(), e.stopPropagation(), closeOverlay();
                        }}
                        style={{ padding: "7px 10px", background: T.card, border: `1px solid ${T.borderActive}`, borderRadius: 8, outline: "none", color: T.text, fontFamily: T.ui, fontSize: 14 }}
                    />
                    {planned.length > 0 && <span style={{ fontSize: 12, color: T.muted }}>Planned steps: {planned.join(" · ")} (⏎ takes the first, ↓ another)</span>}
                </label>
                <div style={{ display: "flex", gap: 22, fontSize: 12, color: T.muted, flexWrap: "wrap" }}>
                    <Key k="⏎" label="start it; the prompt goes in the terminal" />
                    <Key k="⌘1–9" label="epic" />
                    <Key k="⌘0" label="none" />
                    <Key k="esc" label="cancel" />
                </div>
            </div>
        </div>
    );
});
NewStep.displayName = "NewStep";
