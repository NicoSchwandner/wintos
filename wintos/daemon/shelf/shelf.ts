// Claude sessions closed in a project, kept to resume: ⌘W on a session pane puts it here, and a
// session that runs again (resumed from here or by hand) leaves. Keyed by the project's folder,
// so a project closed and reopened in a new tab keeps its shelf.

export type Shelved = { sessionId: string; script: string; label: string; gist?: string; at: number };
export type Shelf = Record<string, Shelved[]>; // folder → newest first

// The resume command the hook writes on a session's pane (wintos-hook.sh), and only that: the
// script is run as is when the session is resumed.
const RESUME = /^cd '(?:[^']|'\\'')*' && (?:CLAUDE_CONFIG_DIR='(?:[^']|'\\'')*' )?claude --resume '([\w-]+)'$/;
export const resumedSession = (script: string) => RESUME.exec(script)?.[1];

export function shelve(shelf: Shelf, folder: string, item: Shelved, keepDays: number): Shelf {
    const rest = unshelve(shelf, item.sessionId);
    const next = { ...rest, [folder]: [item, ...(rest[folder] ?? [])] };
    const oldest = item.at - keepDays * 86_400_000;
    return dropEmpty(Object.fromEntries(Object.entries(next).map(([f, l]) => [f, l.filter((i) => i.at >= oldest)])));
}

export function unshelve(shelf: Shelf, sessionId: string): Shelf {
    return dropEmpty(Object.fromEntries(Object.entries(shelf).map(([f, l]) => [f, l.filter((i) => i.sessionId !== sessionId)])));
}

const dropEmpty = (s: Shelf): Shelf => Object.fromEntries(Object.entries(s).filter(([, l]) => l.length));
