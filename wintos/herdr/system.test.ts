import type { CpuInfo } from "node:os";
import { describe, expect, test, vi } from "vitest";
import { createSystemSampler } from "./backend/system";

const cpu = (user: number, idle: number, sys = 0, nice = 0, irq = 0): CpuInfo => ({
    model: "Synthetic CPU",
    speed: 1000,
    times: { user, nice, sys, idle, irq },
});
const vm = (changes: Record<string, string | number> = {}, pageSize = "16384") => {
    const counts = {
        "Pages free": 40,
        "Pages active": 60,
        "Pages inactive": 50,
        "Pages speculative": 10,
        "File-backed pages": 20,
        "Anonymous pages": 100,
        "Pages purgeable": 10,
        "Pages wired down": 20,
        "Pages occupied by compressor": 5,
        "Pages stored in compressor": 80,
        ...changes,
    };
    return (
        `Mach Virtual Memory Statistics: (page size of ${pageSize} bytes)\n` +
        Object.entries(counts)
            .map(([key, value]) => `${key}: ${value}.`)
            .join("\n")
    );
};
function fixture() {
    let time = 0;
    let cores = [cpu(10, 90), cpu(20, 80)];
    const cpus = vi.fn(() => cores);
    const totalmem = vi.fn(() => 48 * 1024 ** 3);
    const vmStat = vi.fn(async () => vm());
    const now = vi.fn(() => time);
    const sampler = createSystemSampler({ cpus, totalmem, vmStat, now });
    return {
        sampler,
        cpus,
        totalmem,
        vmStat,
        now,
        advance: () => (time += 5000),
        setTime: (value: number) => (time = value),
        cores: (value: CpuInfo[]) => (cores = value),
    };
}

describe("system sampler", () => {
    test("construction is lazy and the first read has RAM but no fabricated CPU zero", async () => {
        const h = fixture();
        for (const dependency of [h.cpus, h.totalmem, h.vmStat, h.now]) expect(dependency).not.toHaveBeenCalled();
        expect(await h.sampler.read()).toEqual({ memory: { used: 1884160, total: 51539607552 } });
    });

    test("aggregates every core and all busy counters into a machine-wide percentage", async () => {
        const h = fixture();
        await h.sampler.read();
        h.advance();
        h.cores([cpu(30, 140, 10, 10, 10), cpu(40, 160, 10, 10, 10)]);
        expect((await h.sampler.read()).cpu).toBeCloseTo(10000 / 230);
    });

    test.each([
        [0, 100, 0],
        [100, 0, 100],
    ])("reports genuine idle/busy extremes (%i, %i)", async (busy, idle, expected) => {
        const h = fixture();
        h.cores([cpu(0, 0)]);
        await h.sampler.read();
        h.advance();
        h.cores([cpu(busy, idle)]);
        expect((await h.sampler.read()).cpu).toBe(expected);
    });

    test("zero elapsed counters remain unknown and the next delta recovers", async () => {
        const h = fixture();
        await h.sampler.read();
        h.advance();
        expect((await h.sampler.read()).cpu).toBeUndefined();
        h.advance();
        h.cores([cpu(60, 140), cpu(70, 130)]);
        expect((await h.sampler.read()).cpu).toBe(50);
    });

    test.each([[cpu(9, 190), cpu(120, 180)], [cpu(10, 90)], [], [cpu(-1, 90)], [cpu(NaN, 90)], [cpu(Infinity, 90)]])(
        "rejects regressing, changed or invalid CPU counters without losing RAM: %j",
        async (...cores) => {
            const h = fixture();
            await h.sampler.read();
            h.advance();
            h.cores(cores);
            const result = await h.sampler.read();
            expect(result.cpu).toBeUndefined();
            expect(result.memory?.used).toBe(1884160);
        }
    );

    test("shares the exact in-flight promise and expires five seconds after collection starts", async () => {
        const h = fixture();
        let finish!: (value: string) => void;
        h.vmStat.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
        const first = h.sampler.read();
        expect(h.sampler.read()).toBe(first);
        await Promise.resolve();
        h.setTime(4000);
        expect(h.sampler.read()).toBe(first);
        finish(vm());
        await first;
        h.setTime(4999);
        expect(await h.sampler.read()).toEqual(await first);
        expect(h.cpus).toHaveBeenCalledTimes(1);
        h.setTime(5000);
        await h.sampler.read();
        expect(h.cpus).toHaveBeenCalledTimes(2);
        expect(h.vmStat).toHaveBeenCalledTimes(2);
    });

    test("a collection lasting beyond expiry is still shared until it finishes", async () => {
        const h = fixture();
        let finish!: (value: string) => void;
        h.vmStat.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
        const first = h.sampler.read();
        await Promise.resolve();
        h.setTime(7000);
        expect(h.sampler.read()).toBe(first);
        finish(vm());
        await first;
        await h.sampler.read();
        expect(h.vmStat).toHaveBeenCalledTimes(2);
    });

    test("copies the CPU snapshot so a provider mutating its counters cannot erase the delta", async () => {
        const h = fixture();
        const core = cpu(10, 90);
        h.cores([core]);
        await h.sampler.read();
        core.times.user += 25;
        core.times.idle += 75;
        h.advance();
        expect((await h.sampler.read()).cpu).toBe(25);
    });

    test.each(["4096", "16384"])(
        "uses the native %s-byte page size and excludes file cache and uncompressed storage",
        async (size) => {
            const h = fixture();
            h.vmStat.mockResolvedValue(vm({ "File-backed pages": 9000, "Pages stored in compressor": 50000 }, size));
            expect((await h.sampler.read()).memory?.used).toBe(size === "4096" ? 471040 : 1884160);
        }
    );

    test.each([
        ["Anonymous pages", 0, 245760],
        ["Pages purgeable", 1000, 0],
        ["Anonymous pages", 900000000, 51539607552],
    ] as const)("clamps valid memory accounting to physical bounds (%s=%i)", async (key, value, expected) => {
        const h = fixture();
        h.vmStat.mockResolvedValue(vm({ [key]: value }));
        expect((await h.sampler.read()).memory?.used).toBe(expected);
    });

    test.each([
        "",
        vm().replace("Mach Virtual Memory Statistics:", "unexpected:"),
        vm({}, "0"),
        vm({}, "NaN"),
        vm({}, "-4096"),
        vm({}, "1.5"),
        vm().replace("Anonymous pages: 100.\n", ""),
        vm({ "Anonymous pages": "-1" }),
        vm({ "Pages wired down": "NaN" }),
        vm({ "Pages purgeable": "2.5" }),
        vm({ "Pages occupied by compressor": "9007199254740992" }),
        vm() + "\nAnonymous pages: 500.",
    ])("rejects malformed native memory data without returning its payload (%#)", async (text) => {
        const h = fixture();
        await h.sampler.read();
        h.advance();
        h.cores([cpu(60, 140), cpu(70, 130)]);
        h.vmStat.mockResolvedValue(text);
        expect(await h.sampler.read()).toEqual({ cpu: 50, error: "System usage unavailable" });
    });

    test.each([0, -1, NaN, Infinity])("rejects invalid total memory %s", async (total) => {
        const h = fixture();
        h.totalmem.mockReturnValue(total);
        expect(await h.sampler.read()).toEqual({ error: "System usage unavailable" });
    });

    test("command failure is generic, cached and recovers without breaking CPU sampling", async () => {
        const h = fixture();
        h.vmStat.mockRejectedValueOnce(Error("sensitive command payload"));
        expect(await h.sampler.read()).toEqual({ error: "System usage unavailable" });
        await h.sampler.read();
        expect(h.vmStat).toHaveBeenCalledTimes(1);
        h.advance();
        h.cores([cpu(60, 140), cpu(70, 130)]);
        expect(await h.sampler.read()).toEqual({ cpu: 50, memory: { used: 1884160, total: 51539607552 } });
    });

    test("CPU provider failure preserves memory and resets its baseline", async () => {
        const h = fixture();
        await h.sampler.read();
        h.advance();
        h.cpus.mockImplementationOnce(() => {
            throw Error("sensitive CPU payload");
        });
        expect(await h.sampler.read()).toEqual({
            memory: { used: 1884160, total: 51539607552 },
            error: "System usage unavailable",
        });
        h.advance();
        expect((await h.sampler.read()).cpu).toBeUndefined();
    });
});
