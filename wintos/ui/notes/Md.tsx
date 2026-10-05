import { Fragment } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { runAction } from "../menu";
import { T } from "../tokens";
import { Box, SIZES, type Size } from "./ProjectNotes";

// A bare url reads as host and path; the scheme and www. say nothing.
const shortUrl = (url: string) => {
    const s = url.replace(/^https?:\/\/(www\.)?/, "");
    return s.length > 47 ? `${s.slice(0, 47)}…` : s;
};

// The notes' markdown (GitHub flavour: tables, task lists, autolinks), styled for the rail and the
// full view. inline: one line inside a row (Next action, a decision) without block margins.
// links: false where a click already means something else (a sidebar row switches project).
// onTick: the file is the developer's (mine.md), so its task boxes toggle, by source line.
export function Md({ text, size, inline, links = true, onTick }: { text: string; size: Size; inline?: boolean; links?: boolean; onTick?: (line: number) => void }) {
    const z = SIZES[size];
    const block: React.CSSProperties = { margin: 0, fontSize: z.text, lineHeight: z.line, color: z.textColor };
    const components: Components = {
        p: ({ children }) => (inline ? <Fragment>{children}</Fragment> : <p style={{ ...block, overflowWrap: "anywhere" }}>{children}</p>),
        h1: ({ children }) => <Heading size={size}>{children}</Heading>,
        h2: ({ children }) => <Heading size={size}>{children}</Heading>,
        h3: ({ children }) => <Heading size={size}>{children}</Heading>,
        h4: ({ children }) => <Heading size={size}>{children}</Heading>,
        h5: ({ children }) => <Heading size={size}>{children}</Heading>,
        h6: ({ children }) => <Heading size={size}>{children}</Heading>,
        ul: ({ children, className }) => (
            <ul style={{ ...block, paddingLeft: className?.includes("contains-task-list") ? 0 : 16, listStyle: className?.includes("contains-task-list") ? "none" : "disc", display: "flex", flexDirection: "column", gap: 2 }}>{children}</ul>
        ),
        ol: ({ children, start }) => (
            <ol start={start} style={{ ...block, paddingLeft: 20, listStyle: "decimal", display: "flex", flexDirection: "column", gap: 2 }}>
                {children}
            </ol>
        ),
        // A task item draws its own box: the checkbox element markdown generates has no source
        // position, the item does, and the line is what a tick flips.
        li: ({ children, className, node }) => {
            if (!className?.includes("task-list-item")) return <li style={{ overflowWrap: "anywhere" }}>{children}</li>;
            const done = !!(node?.children[0] as { properties?: { checked?: boolean } } | undefined)?.properties?.checked;
            const line = (node?.position?.start.line ?? 1) - 1;
            return (
                <li data-item={onTick ? "check" : undefined} data-done={done || undefined} style={{ display: "flex", gap: 8, alignItems: "flex-start", minWidth: 0, overflowWrap: "anywhere", color: done ? T.muted : undefined, textDecoration: done ? "line-through" : undefined }}>
                    <span data-act data-key={onTick ? "x" : undefined} style={{ display: "contents" }}>
                        <Box state={done ? "done" : "todo"} size={size} onToggle={onTick ? () => onTick(line) : undefined} />
                    </span>
                    <span style={{ minWidth: 0 }}>{children}</span>
                </li>
            );
        },
        input: () => null,
        blockquote: ({ children }) => <blockquote style={{ margin: 0, paddingLeft: 10, borderLeft: `2px solid ${T.border}`, color: T.muted, display: "flex", flexDirection: "column", gap: 4 }}>{children}</blockquote>,
        code: ({ children, className }) =>
            className ? (
                <code style={{ fontFamily: T.mono, fontSize: z.code }}>{children}</code>
            ) : (
                <span style={{ fontFamily: T.mono, fontSize: z.code, color: T.emphasis, background: T.cardActive, borderRadius: 4, padding: "0 4px", overflowWrap: "anywhere" }}>{children}</span>
            ),
        pre: ({ children }) => <pre style={{ margin: 0, padding: "6px 8px", background: T.cardActive, borderRadius: 6, overflowX: "auto", color: T.emphasis, fontSize: z.code }}>{children}</pre>,
        table: ({ children }) => (
            <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", fontSize: z.text - 1, lineHeight: 1.45, color: z.textColor }}>{children}</table>
            </div>
        ),
        th: ({ children, style }) => <th style={{ ...style, textAlign: style?.textAlign ?? "left", padding: "3px 8px", borderBottom: `1px solid ${T.border}`, color: T.secondary, fontWeight: 600 }}>{children}</th>,
        td: ({ children, style }) => <td style={{ ...style, padding: "3px 8px", borderBottom: `1px solid ${T.hairline}`, verticalAlign: "top" }}>{children}</td>,
        hr: () => <hr style={{ border: "none", borderTop: `1px solid ${T.hairline}`, margin: "4px 0", width: "100%" }} />,
        img: ({ src, alt }) => <img src={typeof src === "string" ? src : undefined} alt={alt ?? ""} style={{ maxWidth: "100%", borderRadius: 6 }} />,
        a: ({ href, children }) => {
            // An autolinked bare url reads short; a [text](url) link keeps its text.
            const label = typeof children === "string" && children === href ? shortUrl(href) : children;
            if (!links || !href) return <span>{label}</span>;
            // Mouse only, like every link: it opens in WintOS, as the PR rows do.
            return (
                <a
                    data-item="link"
                    data-key="⏎"
                    href={href}
                    title={href}
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => (e.preventDefault(), e.stopPropagation(), void runAction(`open-page:${href}`))}
                    style={{ color: T.emphasis, textDecoration: "underline", textDecorationColor: T.muted, textUnderlineOffset: 2, overflowWrap: "anywhere", cursor: "pointer" }}
                >
                    {label}
                </a>
            );
        },
    };
    const md = (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {text}
        </ReactMarkdown>
    );
    if (inline) return md;
    return <div style={{ display: "flex", flexDirection: "column", gap: z.gap, minWidth: 0 }}>{md}</div>;
}

function Heading({ size, children }: { size: Size; children: React.ReactNode }) {
    const z = SIZES[size];
    return <span style={{ fontSize: z.label, fontWeight: 700, letterSpacing: "0.08em", color: T.faint, marginTop: 4 }}>{children}</span>;
}
