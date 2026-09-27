// Line diff by longest common subsequence. mine.md is a few dozen lines, so O(n·m) is fine.
export function lineDiff(before: string, after: string): string {
    const a = before.split("\n");
    const b = after.split("\n");
    const lcs = a.map(() => new Array<number>(b.length + 1).fill(0));
    lcs.push(new Array<number>(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--)
        for (let j = b.length - 1; j >= 0; j--)
            lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    const out: string[] = [];
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && a[i] === b[j]) (i++, j++);
        else if (i < a.length && (j === b.length || lcs[i + 1][j] >= lcs[i][j + 1])) out.push(`- ${a[i++]}`);
        else out.push(`+ ${b[j++]}`);
    }
    return out.join("\n");
}
