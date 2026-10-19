import { execFile } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { activeMinutes, cutBullets, gist, lastRecaps, lastWorkday, localDay, mergeByTitle, MIN_MINUTES, parseBullets, recapPrompt, recordActivity, type Activity, type RecapItem } from "./recap";
import { userPrompts } from "../sessions/naming";

const KEEP_DAYS = 14;
const RECAP_VERSION = "v3";
const ASKED_KEPT = 4;
const isoDay = localDay;
const read = <T>(file: string, fallback: T): T => {
    try {
        return JSON.parse(readFileSync(file, "utf8"));
    } catch {
        return fallback;
    }
};

// cmd (WINTOS_RECAP_CMD): reads the prompt on stdin, writes the bullets, e.g. `claude -p --model
// haiku`. Without it, or when it fails, each project's last recap is cut to its first sentence.
// extra (WINTOS_RECAP_EXTRA): an instruction added to the prompt, e.g. another source to search.
// factsOf: what the PRs of these sessions did that day, one line each (prFact).
export function dayRecapper(root: string, cmd?: string, extra?: string, factsOf: (sessionIds: string[], day: string) => string[] = () => []) {
    const activityFile = join(root, ".activity.json");
    const recapFile = join(root, ".recaps.json");
    let activity = read<Activity>(activityFile, {});

    const record = (tabId: string, title: string, sessionId: string, transcript: string | undefined, prompt: boolean, now: number) => {
        if (!transcript) return;
        activity = recordActivity(activity, isoDay(now), tabId, title, sessionId, transcript, prompt, KEEP_DAYS);
        try {
            writeFileSync(activityFile, JSON.stringify(activity));
        } catch {} // the daily recap is a convenience; a failed write must not fail the event
    };

    // final: worth keeping for the day; a fallback after a failed command is not, so it is tried again.
    const summarize = (items: RecapItem[], day: string): Promise<{ bullets: string[]; final: boolean }> =>
        new Promise((resolve) => {
            if (!cmd) return resolve({ bullets: cutBullets(items), final: true });
            const child = execFile("/bin/sh", ["-c", cmd], { timeout: 180_000, maxBuffer: 1 << 20 }, (err, out) => {
                const bullets = err ? [] : parseBullets(String(out));
                if (err) console.error(`[wintosd] recap command failed: ${err.message.split("\n")[0]}`);
                resolve(bullets.length ? { bullets, final: true } : { bullets: cutBullets(items), final: false });
            });
            child.stdin?.end(recapPrompt(day, items, extra));
        });

    // The last workday before today with any work in it (a Monday reads the Friday, never the weekend). One run at a
    // time: the windows ask together, and the summarizer takes seconds.
    let running: Promise<{ date: string; bullets: string[] } | null> | undefined;
    const recap = (now: number) => (running ??= build(now).finally(() => (running = undefined)));
    const build = async (now: number): Promise<{ date: string; bullets: string[] } | null> => {
        const today = isoDay(now);
        const day = lastWorkday(Object.keys(activity), today);
        if (!day) return null;
        // The key carries the summary's version, so a day summed up by an older one is written again.
        const key = `${RECAP_VERSION}:${day}`;
        const cached = read<Record<string, string[]>>(recapFile, {});
        if (cached[key]) return { date: day, bullets: cached[key] };
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
            .sort((a, b) => b.minutes - a.minutes);
        const { bullets, final } = items.length ? await summarize(items, day) : { bullets: [], final: true };
        try {
            if (final) writeFileSync(recapFile, JSON.stringify({ [key]: bullets }));
        } catch {}
        return { date: day, bullets };
    };

    // What a session was last about, from its latest recap on any day.
    const gistOf = (sessionId: string): string | undefined => {
        const transcript = Object.values(activity).flatMap((d) => Object.values(d)).map((p) => p.sessions[sessionId]).find(Boolean);
        const last = transcript && lastRecaps(safeText(transcript), "");
        return last ? gist(last) : undefined;
    };

    return { record, recap, gistOf };
}

function safeText(file: string): string {
    try {
        return readFileSync(file, "utf8");
    } catch {
        return "";
    }
}
