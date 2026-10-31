// Design tokens. Colour is a vocabulary: apricot means you are the blocker, blue means something
// to read, brick means something is rotting, moss means a machine is working. The values live in
// theme.css, one set for dark and one for light, following the system's appearance.
export const T = {
    ground: "var(--w-ground)",
    terminal: "var(--w-terminal)",
    sidebar: "var(--w-sidebar)",
    card: "var(--w-card)",
    cardActive: "var(--w-card-active)",
    border: "var(--w-border)",
    borderActive: "var(--w-border-active)",
    hairline: "var(--w-hairline)",
    text: "var(--w-text)",
    emphasis: "var(--w-emphasis)",
    title: "var(--w-title)",
    secondary: "var(--w-secondary)",
    muted: "var(--w-muted)",
    faint: "var(--w-faint)",
    quietTitle: "var(--w-quiet-title)",
    dim: "var(--w-dim)",
    apricot: "var(--w-apricot)",
    brick: "var(--w-brick)",
    moss: "var(--w-moss)",
    blue: "var(--w-blue)",
    aqua: "var(--w-aqua)",
    purple: "var(--w-purple)",
    keycapText: "var(--w-keycap-text)",
    keycapBg: "var(--w-keycap-bg)",
    keycapBorder: "var(--w-keycap-border)",
    display: "'Instrument Serif', Georgia, serif",
    ui: "'Schibsted Grotesk', ui-sans-serif, system-ui, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
} as const;

// The open project's row in the sidebar.
export const ACTIVE: React.CSSProperties = { background: T.borderActive, boxShadow: `inset 3px 0 0 ${T.emphasis}` };

// A session's state as a dot, on its pane header and its chip.
export const SESSION_DOT = { working: T.moss, waiting: T.apricot, parked: T.muted, done: T.dim, idle: T.dim, ended: T.dim } as const;
