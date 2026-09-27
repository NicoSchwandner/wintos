export type ProjectMeta = { id: string; title?: string; titleLocked: boolean; next?: string; pr: string[] };
export type Parsed = { meta: ProjectMeta; body: string } | { error: string };

// ponytail: a line-based reader, not YAML. The front matter is ours and flat; a real
// YAML parser buys nothing until a value needs nesting.
export function parseProjectMd(text: string): Parsed {
    const m = /^---\n([\s\S]*?)\n?---\n?([\s\S]*)$/.exec(text);
    if (!m) return { error: "no front matter" };
    const kv: Record<string, string> = {};
    for (const line of m[1].split("\n")) {
        const i = line.indexOf(":");
        if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    if (!kv.id) return { error: "front matter has no id" };
    const meta: ProjectMeta = {
        id: kv.id,
        titleLocked: kv.title_locked === "true",
        pr: kv.pr ? kv.pr.split(",").map((s) => s.trim()).filter(Boolean) : [],
    };
    if (kv.title) meta.title = kv.title;
    if (kv.next) meta.next = kv.next;
    return { meta, body: m[2] };
}

export function serializeProjectMd(meta: ProjectMeta, body: string): string {
    const lines = [`id: ${meta.id}`];
    if (meta.title) lines.push(`title: ${meta.title}`);
    if (meta.titleLocked) lines.push("title_locked: true");
    if (meta.next) lines.push(`next: ${meta.next}`);
    if (meta.pr.length) lines.push(`pr: ${meta.pr.join(", ")}`);
    return `---\n${lines.join("\n")}\n---\n${body}`;
}
