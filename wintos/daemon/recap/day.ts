import { execFile } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { activeMinutes, cutItems, gist, lastRecaps, lastWorkday, localDay, MAX_ITEMS, mergeByTitle, MIN_MINUTES, noTickets, recapPrompt, recordActivity, type Activity, type RecapItem } from "./recap";
import { choose, parseItems, shownItems, type Curation, type ShownItem, type StandupItem } from "./standup";
import { userPrompts } from "../sessions/naming";

const KEEP_DAYS = 14;
const RECAP_VERSION = "v4";
const ASKED_KEPT = 4;
const isoDay = localDay;
const read = <T>(file: string, fallback: T): T => {
    try {
        return JSON.parse(readFileSync(file, "utf8"));
    } catch {
        return fallback;
    }
};

// cmd (WINTOS_RECAP_CMD): reads the prompt on stdin, writes the items, e.g. `claude -p --model
// haiku`. Without it, or when it fails, each project's last recap is cut to its first sentence.
// extra (WINTOS_RECAP_EXTRA): an instruction added to the prompt, e.g. another source to search.
// factsOf: what the PRs of these sessions did that day, one line each (prFact).
export function dayRecapper(root: string, cmd?: string, extra?: string, factsOf: (sessionIds: string[], day: string) => string[] = () => []) {
    const activityFile = join(root, ".activity.json");
    const recapFile = join(root, ".recaps.json");
    const curationFile = join(root, ".standup.json");
    let activity = read<Activity>(activityFile, {});
    let curation = read<Curation>(curationFile, { days: {}, examples: [] });

    const record = (tabId: string, title: string, sessionId: string, transcript: string | undefined, prompt: boolean, now: number) => {
        if (!transcript) return;
        activity = recordActivity(activity, isoDay(now), tabId, title, sessionId, transcript, prompt, KEEP_DAYS);
        try {
            writeFileSync(activityFile, JSON.stringify(activity));
        } catch {} // the daily recap is a convenience; a failed write must not fail the event
    };

    // final: worth keeping for the day; a fallback after a failed command is not, so it is tried again.
    const summarize = (items: RecapItem[], day: string): Promise<{ items: StandupItem[]; final: boolean }> =>
        new Promise((resolve) => {
            if (!cmd) return resolve({ items: cutItems(items), final: true });
            const child = execFile("/bin/sh", ["-c", cmd], { timeout: 180_000, maxBuffer: 1 << 20 }, (err, out) => {
                const parsed = err ? [] : parseItems(String(out), items.map((i) => i.title)).slice(0, MAX_ITEMS).map((i) => ({ ...i, text: noTickets(i.text), details: i.details.map(noTickets) }));
                if (err) console.error(`[wintosd] recap command failed: ${err.message.split("\n")[0]}`);
                resolve(parsed.length ? { items: parsed, final: true } : { items: cutItems(items), final: false });
            });
            child.stdin?.end(recapPrompt(day, items, extra, curation.examples));
        });

    // The last workday before today with any work in it (a Monday reads the Friday, never the weekend). One run at a
    // time: the windows ask together, and the summarizer takes seconds.
    let running: Promise<{ date: string; items: StandupItem[] } | null> | undefined;
    const proposal = (now: number) => (running ??= build(now).finally(() => (running = undefined)));
    const build = async (now: number): Promise<{ date: string; items: StandupItem[] } | null> => {
        const today = isoDay(now);
        const day = lastWorkday(Object.keys(activity), today);
        if (!day) return null;
        // The key carries the summary's version, so a day summed up by an older one is written again.
        const key = `${RECAP_VERSION}:${day}`;
        const cached = read<Record<string, StandupItem[]>>(recapFile, {});
        if (cached[key]) return { date: day, items: cached[key] };
        const perTab = Object.values(activity[day])
            .map((p): RecapItem => {
                const texts = Object.values(p.sessions).map(safeText);
                const facts = factsOf(Object.keys(p.sessions), day);
                const recaps = texts.flatMap((t) => lastRecaps(t, day) ?? []);
                // Without a recap, what you asked its sessions says what the work was.
                const asked = recaps.length ? [] : texts.flatMap((t) => userPrompts(t)).slice(-ASKED_KEPT);
                return { title: p.title, prompts: p.prompts, minutes: texts.reduce((m, t) => m + activeMinutes(t, day), 0), recaps, facts, asked };
            });
        const items = mergeByTitle(perTab)
            .filter((i) => (i.minutes >= MIN_MINUTES || i.facts.some((f) => /(merged|opened) today/.test(f))) && (i.recaps.length || i.facts.length || i.asked?.length))
            .sort((a, b) => b.prompts - a.prompts || b.minutes - a.minutes);
        const out = items.length ? await summarize(items, day) : { items: [], final: true };
        try {
            if (out.final) writeFileSync(recapFile, JSON.stringify(Object.fromEntries([...Object.entries(cached).filter(([k]) => k.startsWith(`${RECAP_VERSION}:`) && Object.keys(activity).includes(k.slice(-10))), [key, out.items]])));
        } catch {}
        return { date: day, items: out.items };
    };

    // The proposal as you left it: dropped, lifted and rewritten items.
    const recap = async (now: number): Promise<{ date: string; items: ShownItem[] } | null> => {
        const p = await proposal(now);
        return p && { date: p.date, items: shownItems(p.items, curation, p.date) };
    };

    // undefined: no such item on the day being shown.
    const curate = async (id: string, change: { drop?: boolean; top?: boolean; text?: string }, now: number): Promise<{ date: string; items: ShownItem[] } | undefined> => {
        const p = await proposal(now);
        const item = p?.items.find((i) => i.id === id);
        if (!p || !item) return undefined;
        curation = choose(curation, p.date, item, change, now);
        try {
            writeFileSync(curationFile, JSON.stringify(curation));
        } catch {}
        return { date: p.date, items: shownItems(p.items, curation, p.date) };
    };

    // What you read out about a day: its items as you left them, the dropped ones left out. Kept as
    // long as the day's activity is, so a weekly reflection can look back on its days.
    const readOut = (day: string): string[] => {
        const items = read<Record<string, StandupItem[]>>(recapFile, {})[`${RECAP_VERSION}:${day}`];
        return items ? shownItems(items, curation, day).filter((i) => !i.dropped).map((i) => i.text) : [];
    };

    // What a session was last about, from its latest recap on any day.
    const gistOf = (sessionId: string): string | undefined => {
        const transcript = Object.values(activity).flatMap((d) => Object.values(d)).map((p) => p.sessions[sessionId]).find(Boolean);
        const last = transcript && lastRecaps(safeText(transcript), "");
        return last ? gist(last) : undefined;
    };

    return { record, recap, curate, readOut, gistOf };
}

function safeText(file: string): string {
    try {
        return readFileSync(file, "utf8");
    } catch {
        return "";
    }
}
