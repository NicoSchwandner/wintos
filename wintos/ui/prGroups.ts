import type { Group } from "../daemon/prs/group";

// What each PR group asks of you, as the PR pages name it.
export const GROUP_HEADERS: Record<Group, { label: string; note: string }> = {
    merge: { label: "Merge", note: "approved, green, waiting on the button" },
    fix: { label: "Fix", note: "your PR, ball in your court" },
    review: { label: "Review", note: "someone asked you" },
    chase: { label: "Chase", note: "past the team's two working days with nobody on it" },
    release: { label: "Release", note: "merged past two working days, not on main yet" },
    waiting: { label: "Waiting", note: "yours, with someone else" },
    team: { label: "The team's", note: "asked of your team: yours to review too" },
};
