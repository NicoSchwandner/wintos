// Design tokens from the WintOS panel spec §8. Colour is a vocabulary: apricot means you are
// the blocker, blue means something to read, brick means something is rotting, moss means a
// machine is working.
export const T = {
    ground: "#000000",
    terminal: "#000000",
    sidebar: "#0f0e0d",
    card: "#181615",
    cardActive: "#221f1d",
    border: "#221f1d",
    borderActive: "#34302c",
    hairline: "#181615",
    text: "#ebdbb2",
    emphasis: "#fbf1c7",
    title: "#ebdbb2",
    secondary: "#d5c4a1",
    muted: "#a89984",
    faint: "#7c6f64",
    quietTitle: "#bdae93",
    dim: "#665c54",
    apricot: "#fe8019",
    brick: "#fb4934",
    moss: "#b8bb26",
    blue: "#83a598",
    keycapText: "#d5c4a1",
    keycapBg: "#221f1d",
    keycapBorder: "#34302c",
    display: "'Instrument Serif', Georgia, serif",
    ui: "'Schibsted Grotesk', ui-sans-serif, system-ui, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
} as const;

// The open project's row in the sidebar.
export const ACTIVE: React.CSSProperties = { background: T.borderActive, boxShadow: `inset 3px 0 0 ${T.emphasis}` };

// A session's state as a dot, on its pane header and its chip.
export const SESSION_DOT = { working: T.moss, waiting: T.apricot, parked: T.muted, done: T.dim, idle: T.dim, ended: T.dim } as const;
