import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getBlockComponentModel } from "@/store/global";
import { stringToBase64 } from "@/util/util";

export const asTyped = (text: string) => (text.includes("\n") ? `\x1b[200~${text}\x1b[201~` : text);

// One screen row as characters, each with whether it is drawn faint.
export type Row = { ch: string; dim: boolean }[];

const text = (row: Row) => row.map((c) => c.ch).join("");
const isRule = (row: Row) => text(row).trimStart().startsWith("─");

// Whether Claude's input box holds something you wrote: the line after a rule that starts with its
// prompt, and the lines down to the next rule. Its placeholder ("Try …") is drawn faint, so only
// text that is not counts.
export function hasDraft(rows: Row[]): boolean {
    for (let i = rows.length - 1; i > 0; i--) {
        if (!/^[❯>][\s ]/.test(text(rows[i])) || !isRule(rows[i - 1])) continue;
        for (let j = i; j < rows.length && !isRule(rows[j]); j++)
            if (rows[j].some((c, x) => !(j === i && x < 2) && !c.dim && c.ch.trim() !== "")) return true;
        return false;
    }
    return false;
}

// The rows on screen in a pane's terminal; undefined when this window doesn't draw it.
function screenRows(blockId: string): Row[] | undefined {
    const term = (getBlockComponentModel(blockId)?.viewModel as { termRef?: { current?: { terminal?: import("@xterm/xterm").Terminal } } } | undefined)?.termRef?.current?.terminal;
    if (!term) return undefined;
    const buf = term.buffer.active;
    const rows: Row[] = [];
    for (let y = buf.viewportY; y < buf.viewportY + term.rows; y++) {
        const line = buf.getLine(y);
        const row: Row = [];
        for (let x = 0; line && x < term.cols; x++) {
            const cell = line.getCell(x);
            if (cell && cell.getWidth()) row.push({ ch: cell.getChars() || " ", dim: !!cell.isDim() });
        }
        rows.push(row);
    }
    return rows;
}

// Thrown when the pane's Claude has a half-written prompt: typing in would send it along. The
// caller keeps what it meant to deliver and tries again later.
export class DraftInPane extends Error {}
export const DRAFT_RETRY_MS = 5000;

// A prompt into a Claude pane: the text, then Enter on its own, so Claude doesn't take both for one paste.
// Rejects when the pane has no running process to take it, or a draft of yours in its input.
export async function typeIntoPane(blockId: string, text: string): Promise<void> {
    const rows = screenRows(blockId);
    if (rows && hasDraft(rows)) throw new DraftInPane(`pane ${blockId.slice(0, 6)} has a draft`);
    const type = (t: string) => RpcApi.ControllerInputCommand(TabRpcClient, { blockid: blockId, inputdata64: stringToBase64(t) });
    await type(asTyped(text));
    await new Promise((done) => setTimeout(done, 300));
    await type("\r");
}

// For a prompt you asked for yourself (a PR's next step): it waits while your draft is in the box
// and goes in once you have sent or cleared it, for up to ten minutes.
export async function typeWhenFree(blockId: string, text: string, tries = 120): Promise<void> {
    for (let i = 0; ; i++) {
        try {
            return await typeIntoPane(blockId, text);
        } catch (e) {
            if (!(e instanceof DraftInPane) || i >= tries) throw e;
            await new Promise((done) => setTimeout(done, DRAFT_RETRY_MS));
        }
    }
}
