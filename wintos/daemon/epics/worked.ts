// The day's "Today's focus" in the journal, written from what you worked on rather than planned:
// each step you prompted that day, under its epic, the epics in the order you first worked on
// them, and steps in no epic last.
export type WorkedStep = { epic?: string; step: string };

export function workedFocus(steps: WorkedStep[]): string {
    const order: (string | undefined)[] = [];
    for (const s of steps) if (!order.includes(s.epic)) order.push(s.epic);
    const groups = [...order.filter((e) => e !== undefined), ...(order.includes(undefined) ? [undefined] : [])];
    return groups
        .map((epic) => {
            const names = [...new Set(steps.filter((s) => s.epic === epic).map((s) => s.step))];
            return [`- ${epic ?? "Outside the epics"}`, ...names.map((n) => `  - ${n}`)].join("\n");
        })
        .join("\n");
}
