import { execFile } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { cutBullets, gist, lastRecaps, parseBullets, recapPrompt, recordActivity, type Activity, type RecapItem } from "./recap";

const KEEP_DAYS = 14;
const isoDay = (t: number) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
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
export function dayRecapper(root: string, cmd?: string, extra?: string) {
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

    // The last day before today with any work in it (a Monday reads the Friday). One run at a
    // time: the windows ask together, and the summarizer takes seconds.
    let running: Promise<{ date: string; bullets: string[] } | null> | undefined;
    const recap = (now: number) => (running ??= build(now).finally(() => (running = undefined)));
    const build = async (now: number): Promise<{ date: string; bullets: string[] } | null> => {
        const today = isoDay(now);
        const day = Object.keys(activity).filter((d) => d < today).sort().pop();
        if (!day) return null;
        const cached = read<Record<string, string[]>>(recapFile, {});
        if (cached[day]) return { date: day, bullets: cached[day] };
        const items = Object.values(activity[day])
            .map((p) => ({ title: p.title, prompts: p.prompts, recaps: Object.values(p.sessions).flatMap((t) => lastRecaps(safeText(t), day) ?? []) }))
            .filter((i) => i.prompts > 0 && i.recaps.length)
            .sort((a, b) => b.prompts - a.prompts);
        const { bullets, final } = items.length ? await summarize(items, day) : { bullets: [], final: true };
        try {
            if (final) writeFileSync(recapFile, JSON.stringify({ [day]: bullets }));
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
