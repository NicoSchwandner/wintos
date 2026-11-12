import { execFile } from "child_process";
import { promisify } from "util";

const run = promisify(execFile);
const git = (dir: string, ...args: string[]) => run("git", args, { cwd: dir, timeout: 60_000 });
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Commits the journal folder and pushes it. Only that folder is committed (`-- .` from inside it):
// the rest of the repo, staged or not, stays the developer's own to commit.
export async function syncJournal(dir: string, now: Date): Promise<"pushed" | "unchanged" | string> {
    await git(dir, "add", "-A", "--", ".");
    try {
        await git(dir, "diff", "--cached", "--quiet", "--", ".");
        return "unchanged";
    } catch {}
    await git(dir, "commit", "-q", "-m", `Journal ${isoDay(now)}`, "--", ".");
    try {
        await git(dir, "push", "-q");
    } catch {
        // The journal is also committed from elsewhere (voice notes): catch up, then push once more.
        // A failure here leaves the commit, and the next sync pushes it.
        try {
            await git(dir, "pull", "-q", "--rebase", "--autostash");
            await git(dir, "push", "-q");
        } catch (e) {
            return `push failed: ${(e as { stderr?: string }).stderr?.trim() || e}`;
        }
    }
    return "pushed";
}

// The journal changes in bursts (ticks, the recap, an editor): sync once it has been quiet a while.
export function syncWhenQuiet(dir: string, quietMs = 120_000): () => void {
    let timer: NodeJS.Timeout | undefined;
    return () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            syncJournal(dir, new Date())
                .then((r) => r !== "unchanged" && console.log(`[wintosd] journal: ${r}`))
                .catch((e) => console.error(`[wintosd] journal sync failed: ${e}`));
        }, quietMs);
        timer.unref();
    };
}
