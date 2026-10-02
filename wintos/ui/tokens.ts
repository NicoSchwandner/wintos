// Design tokens from the WintOS panel spec §8. Colour is a vocabulary: apricot means you are
// the blocker, brick means something is rotting, moss means a machine is working.
export const T = {
    ground: "#1d2021",
    terminal: "#1d2021",
    sidebar: "#282828",
    card: "#32302f",
    cardActive: "#3c3836",
    border: "#3c3836",
    borderActive: "#504945",
    hairline: "#32302f",
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
    keycapText: "#d5c4a1",
    keycapBg: "#3c3836",
    keycapBorder: "#504945",
    display: "'Instrument Serif', Georgia, serif",
    ui: "'Schibsted Grotesk', ui-sans-serif, system-ui, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
} as const;

// The open project's row in the sidebar.
export const ACTIVE: React.CSSProperties = { background: T.borderActive, boxShadow: `inset 3px 0 0 ${T.emphasis}` };
