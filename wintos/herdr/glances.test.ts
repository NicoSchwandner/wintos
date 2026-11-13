import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createCompanion } from "./companion";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

test("sidebar endpoints read their own providers and retain browser Origin protection", async () => {
    const root = await mkdtemp(join(tmpdir(), "herdr-glances-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const calendar = {
        meetings: [{ title: "Planning", start: "2026-11-13T10:00:00Z", end: "2026-11-13T11:00:00Z", room: "Room A" }],
    };
    const system = { cpu: 42, memory: { used: 12, total: 48 } };
    const service = await createCompanion({
        root,
        wintosRoot: join(root, "history"),
        codexHome: false,
        pollMs: 0,
        calendar: async () => calendar,
        system: async () => system,
    });
    cleanups.push(() => service.close());
    const port = await service.listen(0);
    for (const [path, expected] of [
        ["meetings", calendar],
        ["system", system],
    ] as const) {
        const response = await fetch(`http://127.0.0.1:${port}/${path}`);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(expected);
        expect(
            (await fetch(`http://127.0.0.1:${port}/${path}`, { headers: { Origin: "https://example.com" } })).status
        ).toBe(403);
    }
});

test("calendar and system failures remain separate from companion health and wakes", async () => {
    const root = await mkdtemp(join(tmpdir(), "herdr-glances-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const service = await createCompanion({
        root,
        wintosRoot: join(root, "history"),
        codexHome: false,
        pollMs: 0,
        calendar: async () => ({ meetings: [], error: "Calendar unavailable" }),
        system: async () => ({ error: "System usage unavailable" }),
    });
    cleanups.push(() => service.close());
    const port = await service.listen(0);
    for (const path of ["meetings", "system"]) {
        const response = await fetch(`http://127.0.0.1:${port}/${path}`);
        expect(response.status).toBe(200);
        expect(await response.json()).toHaveProperty("error");
    }
    expect(await (await fetch(`http://127.0.0.1:${port}/health`)).json()).toEqual({ ok: true });
    expect(await (await fetch(`http://127.0.0.1:${port}/wakes`)).json()).toEqual([]);
});
