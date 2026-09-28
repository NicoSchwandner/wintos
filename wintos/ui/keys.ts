// A view's single-letter keys (j, k, r, e, 1–9) must not also fire for ⌘J, ⌘R, ⌘E…, which
// are WintOS's own: ⌘J moved the PR list and switched the project at once.
export const isPlainKey = (e: { metaKey: boolean; ctrlKey: boolean; altKey: boolean }) => !e.metaKey && !e.ctrlKey && !e.altKey;
