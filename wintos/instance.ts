// Which WintOS this is. A second instance (development) sets WINTOS_PORT for its own daemon
// and WINTOS_INSTANCE for the banner that keeps anyone from working in it by mistake.
export const DEFAULT_PORT = 7730;

export function wintosInstance(env: Record<string, string | undefined>): { port: number; label: string } {
    const port = Number(env.WINTOS_PORT);
    return { port: Number.isInteger(port) && port > 0 ? port : DEFAULT_PORT, label: env.WINTOS_INSTANCE ?? "" };
}
