import { existsSync, readFileSync, renameSync, writeFileSync } from "fs";

// The daemon's state files. A write goes to a temporary file first and is renamed over the old
// one, so a crash mid-write leaves the old file whole instead of half a file.
export function writeJsonAtomic(file: string, data: unknown): void {
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, file);
}

// A missing file is a fresh start. An unreadable one is kept as <file>.corrupt and said in the
// log, rather than read as empty and overwritten by the next write.
export function readJson<T>(file: string, fallback: T): T {
    if (!existsSync(file)) return fallback;
    const text = readFileSync(file, "utf8");
    try {
        return JSON.parse(text);
    } catch (e) {
        writeFileSync(`${file}.corrupt`, text);
        console.error(`[wintosd] ${file} is unreadable (${e}); kept as ${file}.corrupt, starting empty`);
        return fallback;
    }
}
