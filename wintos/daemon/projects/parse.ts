// kind: what the project is for, which says when it is finished (a support errand once its PR is
// up, a review once it is posted). Set from the first session's lane; the file can say otherwise.
export const KINDS = ["drive", "support", "review"] as const;
export type Kind = (typeof KINDS)[number];
import { parseUnits, serializeUnits, type Unit } from "./units";

export type ProjectMeta = { id: string; title?: string; titleLocked: boolean; next?: string; pr: string[]; kind?: Kind; units?: Unit[] };
export type Parsed = { meta: ProjectMeta; body: string } | { error: string };

// ponytail: a line-based reader, not YAML. The front matter is ours and flat; a real
// YAML parser buys nothing until a value needs nesting.
export function parseProjectMd(raw: string): Parsed {
    const text = raw.replace(/\r\n/g, "\n");
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
    if ((KINDS as readonly string[]).includes(kv.kind)) meta.kind = kv.kind as Kind;
    if (kv.units && parseUnits(kv.units).length) meta.units = parseUnits(kv.units);
    return { meta, body: m[2] };
}

export function serializeProjectMd(meta: ProjectMeta, body: string): string {
    const lines = [`id: ${meta.id}`];
    if (meta.title) lines.push(`title: ${meta.title}`);
    if (meta.titleLocked) lines.push("title_locked: true");
    if (meta.next) lines.push(`next: ${meta.next}`);
    if (meta.pr.length) lines.push(`pr: ${meta.pr.join(", ")}`);
    if (meta.kind) lines.push(`kind: ${meta.kind}`);
    if (meta.units?.length) lines.push(`units: ${serializeUnits(meta.units)}`);
    return `---\n${lines.join("\n")}\n---\n${body}`;
}
