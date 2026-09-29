// A link on a GitHub page that leaves GitHub (a ticket, a dashboard) opens a new pane beside the
// page, so the PR stays. GitHub moves between its own pages client-side, which never gets here.
// Other sites navigate in place: their cross-site hops are mostly login redirects.
const SOURCES = new Set(["github.com"]);

const parse = (u: string) => {
    try {
        const url = new URL(u);
        return url.protocol === "https:" || url.protocol === "http:" ? url : undefined;
    } catch {
        return undefined;
    }
};

export function opensNewPane(fromUrl: string, toUrl: string): boolean {
    const from = parse(fromUrl);
    const to = parse(toUrl);
    return !!from && !!to && SOURCES.has(from.hostname) && to.hostname !== from.hostname;
}
