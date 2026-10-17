import * as markdown from "prettier/plugins/markdown";
import { format } from "prettier/standalone";

// Markdown the developer edits in WintOS, tidied the way prettier would before it is written.
// Fail-open: text prettier cannot parse is saved as typed.
export async function formatMarkdown(text: string): Promise<string> {
    try {
        return await format(text, { parser: "markdown", plugins: [markdown], proseWrap: "preserve" });
    } catch {
        return text;
    }
}
