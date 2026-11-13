import { transformSync } from "esbuild";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createCalendarFeed } from "./backend/calendar";
import { meetingRows } from "./meetings";

const now = new Date(2026, 10, 13, 10, 0).getTime();
const iso = (hour: number, minute = 0, day = 13) => new Date(2026, 10, day, hour, minute).toISOString();
const meeting = (title: string, hour: number, extra = {}) => ({
    title,
    start: iso(hour),
    end: iso(hour + 1),
    ...extra,
});
const pair = {
    meetings: [
        meeting("Planning ".repeat(80), 10, { room: "Room North" }),
        meeting("Review", 12, { room: "Room South", reply: "tentative" }),
    ],
};

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("meetingRows", () => {
    test("retains an ongoing overnight meeting after midnight and includes the next meeting", () => {
        const rows = meetingRows(
            {
                meetings: [
                    { title: "Overnight", start: iso(23, 30), end: iso(1, 0, 14), room: "Room North" },
                    meeting("Morning", 9, { start: iso(9, 0, 14), end: iso(10, 0, 14), room: "Room South" }),
                ],
            },
            new Date(2026, 10, 14, 0, 15).getTime()
        );
        expect(rows).toEqual([
            { title: "Overnight", time: "23:30 – 01:00", room: "Room North" },
            { title: "Morning", time: "09:00 – 10:00", room: "Room South" },
        ]);
    });
    test("formats local 24-hour times without dates or native locale support", () => {
        vi.spyOn(Date.prototype, "toLocaleTimeString").mockImplementation(() => "09:00:00 AM");
        vi.spyOn(Date.prototype, "toLocaleDateString").mockImplementation(() => "11/16/2026");
        expect(
            meetingRows(
                {
                    meetings: [
                        meeting("Upcoming", 12, {
                            start: iso(12),
                            end: iso(13),
                            room: "Room North",
                        }),
                    ],
                },
                now
            )[0]
        ).toEqual({
            title: "Upcoming",
            time: "12:00 – 13:00",
            room: "Room North",
        });
    });
    test("keeps both rooms and caps the display at two meetings", () => {
        expect(meetingRows({ meetings: [...pair.meetings, meeting("Later", 14)] }, now)).toEqual([
            { title: "Planning ".repeat(80), time: "10:00 – 11:00", room: "Room North" },
            { title: "Review", time: "12:00 – 13:00", room: "Room South", unaccepted: true },
        ]);
    });
    test("an imminent meeting replaces the current one, with the following start second", () => {
        const rows = meetingRows(
            {
                meetings: [
                    meeting("Current", 9, { end: iso(11) }),
                    meeting("Imminent", 10, { start: iso(10, 1) }),
                    meeting("Following", 11),
                ],
            },
            now
        );
        expect(rows.map((r) => r.title)).toEqual(["Imminent", "Following"]);
    });
    test("overlapping and simultaneous meetings use the existing accepted-first selection", () => {
        const rows = meetingRows(
            {
                meetings: [
                    meeting("Pending", 9, { reply: "pending", end: iso(11) }),
                    meeting("Accepted", 9, { end: iso(11) }),
                    meeting("Overlap", 9, { start: iso(9, 30), end: iso(11) }),
                    meeting("Next", 12),
                ],
            },
            now
        );
        expect(rows.map((r) => r.title)).toEqual(["Accepted", "Next"]);
    });
    test.each([undefined, "", "   "])("missing room %s is explicit and pending invites are marked", (room) => {
        expect(meetingRows({ meetings: [meeting("Invite", 12, { room, reply: "pending" })] }, now)).toEqual([
            { title: "Invite", time: "12:00 – 13:00", room: "Room not listed", unaccepted: true },
        ]);
    });
    test("normalizes unsorted input and drops malformed and ended entries", () => {
        expect(
            meetingRows(
                {
                    meetings: [
                        meeting("Second", 14),
                        meeting("Ended", 8),
                        meeting("Invalid", 12, { end: "invalid" }),
                        meeting("First", 12),
                    ],
                },
                now
            ).map((r) => r.title)
        ).toEqual(["First", "Second"]);
    });
    test("shows no meetings when only tomorrow or later days remain", () => {
        expect(
            meetingRows(
                {
                    meetings: [
                        meeting("Ended today", 8),
                        meeting("Tomorrow", 9, { start: iso(9, 0, 14), end: iso(10, 0, 14) }),
                        meeting("Monday", 9, { start: iso(9, 0, 16), end: iso(10, 0, 16) }),
                    ],
                },
                now
            )
        ).toEqual([]);
    });
    test("does not fill a remaining slot with tomorrow's meeting", () => {
        expect(
            meetingRows(
                {
                    meetings: [
                        meeting("Today", 12, { room: "Room North" }),
                        meeting("Tomorrow", 9, { start: iso(9, 0, 14), end: iso(10, 0, 14) }),
                    ],
                },
                now
            )
        ).toEqual([{ title: "Today", time: "12:00 – 13:00", room: "Room North" }]);
    });
    test("today's simultaneous starts keep one accepted representative before the following meeting", () => {
        const accepted = meeting("Accepted", 12);
        expect(
            meetingRows(
                {
                    meetings: [
                        meeting("Pending", 12, { reply: "pending" }),
                        accepted,
                        accepted,
                        meeting("Following", 14),
                        meeting("Tomorrow", 9, { start: iso(9, 0, 14), end: iso(10, 0, 14) }),
                    ],
                },
                now
            ).map((row) => row.title)
        ).toEqual(["Accepted", "Following"]);
    });
    test("stale cached data follows the local day across midnight without showing tomorrow early", () => {
        const data = {
            error: "Calendar unavailable",
            meetings: [
                meeting("Today", 23, { start: iso(23), end: iso(23, 30) }),
                meeting("Next day", 9, { start: iso(9, 0, 14), end: iso(10, 0, 14) }),
            ],
        };
        expect(meetingRows(data, new Date(2026, 10, 13, 23, 45).getTime())).toEqual([]);
        expect(meetingRows(data, new Date(2026, 10, 14, 0, 15).getTime()).map((row) => row.title)).toEqual([
            "Next day",
        ]);
        expect(meetingRows(data, new Date(2026, 10, 14, 10).getTime())).toEqual([]);
        expect(meetingRows({ meetings: [] }, now)).toEqual([]);
    });
});

type Element = { kind: string; children: (Element | string)[]; styles: Record<string, unknown>; [key: string]: any };
function element(kind: string): Element {
    const el: Element = { kind, children: [], styles: {} };
    for (const name of [
        "id",
        "size_full",
        "w_full",
        "h",
        "px",
        "py",
        "gap",
        "bg",
        "text_size",
        "text_color",
        "font_semibold",
        "truncate",
        "flex_none",
        "min_w",
        "flex_1",
        "items_center",
    ]) {
        el[name] = (...args: unknown[]) => {
            el.styles[name] = args.length ? args[0] : true;
            return el;
        };
    }
    el.child = (child: Element | string) => {
        el.children.push(child);
        return el;
    };
    return el;
}
function nodes(el: Element): Element[] {
    return [el, ...el.children.flatMap((child) => (typeof child === "string" ? [] : nodes(child)))];
}
function text(el: Element): string {
    return nodes(el)
        .flatMap((n) => n.children.filter((c) => typeof c === "string"))
        .join("\n");
}
function host(fetch: (url: string) => Promise<unknown>) {
    const module = { exports: {} as any };
    const effects: unknown[][] = [];
    const timers: { ms: number; callback: (cx: any) => void }[] = [];
    const pending: Promise<void>[] = [];
    const notify = vi.fn();
    const cx = {
        notify,
        spawn: (f: any) => pending.push(f(cx)),
        timer: { every: (ms: number, callback: any) => timers.push({ ms, callback }) },
    };
    runInNewContext(
        transformSync(readFileSync(`${__dirname}/mods/wintos-meetings/main.js`, "utf8"), { format: "cjs" }).code,
        {
            module,
            exports: module.exports,
            fetch,
            Date,
            require: (name: string) => {
                if (name === "./model.js") return { meetingRows };
                if (name === "gpui-kit") return { View: class {}, div: () => element("div") };
                if (name === "gpui-base") return { v_flex: () => element("column"), h_flex: () => element("row") };
                if (name === "herdr")
                    return {
                        theme: () => ({
                            chrome: "chrome",
                            foreground: "foreground",
                            muted: "muted",
                            dim: "dim",
                            blocked: "blocked",
                        }),
                        run: (...args: unknown[]) => effects.push(args),
                    };
                throw Error(`Unexpected dependency: ${name}`);
            },
        }
    );
    const mod = new module.exports.default();
    mod.init({}, cx);
    return { mod, effects, timers, pending, notify, cx, settle: () => Promise.all(pending) };
}
const ok = (data: unknown) => ({ ok: true, json: async () => data });

function frozenClock() {
    vi.useFakeTimers();
    vi.setSystemTime(now);
}

describe("native meetings mod", () => {
    test("the actual minute timer refreshes the backend after a 20ms fetch instead of waiting two minutes", async () => {
        frozenClock();
        let requests = 0;
        const calendarFetch = vi.fn<typeof globalThis.fetch>(
            () =>
                new Promise<Response>((resolve) => {
                    const poll = ++requests;
                    setTimeout(
                        () =>
                            resolve(
                                new Response(`BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:synthetic-cadence
SUMMARY:Poll ${poll}
DTSTART:20261113T130000
DTEND:20261113T140000
LOCATION:Room North
END:VEVENT
END:VCALENDAR`)
                            ),
                        20
                    );
                })
        );
        const feed = createCalendarFeed({
            loadSettings: () => ({ url: "https://calendar.example.test/synthetic.ics" }),
            fetch: calendarFetch,
            now: () => Date.now(),
        });
        const companionFetch = vi.fn(async (url: string) => {
            expect(url).toBe("http://127.0.0.1:7732/meetings");
            return ok(await feed.read());
        });
        const h = host(companionFetch);
        expect(h.timers.map((timer) => timer.ms)).toEqual([60_000]);
        const timer = setInterval(() => h.timers[0].callback(h.cx), h.timers[0].ms);
        try {
            await vi.advanceTimersByTimeAsync(20);
            await h.settle();
            expect(text(h.mod.render())).toContain("Poll 1");
            expect(h.mod.cache.updatedAt).toBe(now + 20);
            await vi.advanceTimersByTimeAsync(59_980);
            expect(Date.now()).toBe(now + 60_000);
            expect(calendarFetch).toHaveBeenCalledTimes(2);
            await vi.advanceTimersByTimeAsync(20);
            await h.settle();
            expect(text(h.mod.render())).toContain("Poll 2");
            expect(h.mod.cache.updatedAt).toBe(now + 60_020);
            expect(companionFetch).toHaveBeenCalledTimes(2);
        } finally {
            clearInterval(timer);
        }
    });
    test("fetches on init and every minute, renders separate nonshrinking room lines and resizes only its own slot", async () => {
        frozenClock();
        const fetch = vi.fn(async () => ok(pair));
        const h = host(fetch);
        await h.settle();
        expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:7732/meetings");
        expect(h.timers.map((t) => t.ms)).toEqual([60_000]);
        const tree = h.mod.render();
        expect(tree.styles.bg).toBe("chrome");
        expect(tree.styles.text_size).toBe(12);
        expect(tree.styles.py).toBe(4);
        expect(text(tree)).not.toContain("Meetings");
        for (const room of ["Room North"]) {
            const line = nodes(tree).find((n) => n.children.includes(room))!;
            expect(line).toBeDefined();
            expect(line.styles.flex_none).toBe(true);
            const row = nodes(tree).find((n) => n.children.includes(line))!;
            expect(row.kind).toBe("column");
            expect(row.styles.h).toBe(46);
            expect(row.styles.gap).toBe(0);
            expect(row.children.map((child: Element) => child.styles.h)).toEqual([14, 16, 16]);
            expect(
                row.children.some(
                    (n: any) =>
                        typeof n !== "string" &&
                        n.styles.truncate &&
                        text(n).includes(room === "Room North" ? "Planning" : "Review")
                )
            ).toBe(true);
        }
        const then = tree.children[1] as Element;
        expect(then.kind).toBe("row");
        expect(then.styles.h).toBe(16);
        expect(text(then)).toContain("Then 12:00");
        expect(text(then)).toContain("Review");
        expect(text(then)).toContain("Room South");
        expect(nodes(then).find((node) => node.children.includes("Review"))!.styles).toMatchObject({
            flex_1: true,
            truncate: true,
        });
        expect(nodes(then).find((node) => node.children.includes("· Room South"))!.styles.flex_none).toBe(true);
        expect(text(tree)).not.toContain("not accepted");
        expect(h.effects.at(-1)).toEqual(["layout.resize", { id: "wintos-meetings", px: 74 }]);
        h.timers[0].callback(h.cx);
        await h.settle();
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(h.notify).toHaveBeenCalled();
    });
    test("the native view hides future-day data and shows today's empty state after the last meeting", async () => {
        frozenClock();
        const h = host(async () =>
            ok({
                meetings: [
                    meeting("Today", 12, { room: "Room North" }),
                    meeting("Tomorrow", 9, { start: iso(9, 0, 14), end: iso(10, 0, 14), room: "Room South" }),
                ],
            })
        );
        await h.settle();
        expect(text(h.mod.render())).toContain("Today");
        expect(text(h.mod.render())).toContain("Room North");
        expect(text(h.mod.render())).not.toMatch(/Tomorrow|Room South|Then/);
        expect(h.effects.at(-1)).toEqual(["layout.resize", { id: "wintos-meetings", px: 54 }]);
        vi.setSystemTime(now + 4 * 3_600_000);
        h.timers[0].callback(h.cx);
        await h.settle();
        expect(text(h.mod.render())).toBe("No more meetings today");
        expect(h.effects.at(-1)).toEqual(["layout.resize", { id: "wintos-meetings", px: 28 }]);
    });
    test("shrinks for one and empty, distinguishing empty from unavailable", async () => {
        frozenClock();
        const replies = [ok({ meetings: [pair.meetings[0]] }), ok({ meetings: [] })];
        const h = host(async () => replies.shift());
        await h.settle();
        expect(h.effects.at(-1)).toEqual(["layout.resize", { id: "wintos-meetings", px: 54 }]);
        h.timers[0].callback(h.cx);
        await h.settle();
        expect(h.effects.at(-1)).toEqual(["layout.resize", { id: "wintos-meetings", px: 28 }]);
        expect(text(h.mod.render())).toContain("No more meetings today");
        expect(text(h.mod.render())).not.toContain("unavailable");
    });
    test.each(["network", "http", "json", "shape", "null", "primitive", "missing", "backend"])(
        "%s failure reselects remaining cached meetings, clears ended rows and recovers",
        async (failure) => {
            frozenClock();
            let request = 0;
            const h = host(async () => {
                if (++request === 1 || request === 4)
                    return ok({ meetings: [...pair.meetings, meeting("Later cached", 14, { room: "Room East" })] });
                if (failure === "network") throw Error("secret calendar address");
                if (failure === "http") return { ok: false };
                if (failure === "json")
                    return {
                        ok: true,
                        json: async () => {
                            throw Error("private payload");
                        },
                    };
                if (failure === "shape") return ok({ meetings: null });
                if (failure === "null") return ok(null);
                if (failure === "primitive") return ok("private data");
                if (failure === "missing") return ok({});
                return ok({ meetings: [], error: "private configuration", updatedAt: now - 120_000 });
            });
            await h.settle();
            vi.setSystemTime(now + 3 * 3_600_000);
            h.timers[0].callback(h.cx);
            await h.settle();
            const stale = text(h.mod.render());
            expect(stale).not.toContain("Room North");
            expect(stale).not.toContain("Room South");
            expect(stale).toContain("Room East");
            expect(h.effects.at(-1)).toEqual(["layout.resize", { id: "wintos-meetings", px: 72 }]);
            expect(stale).toContain("stale");
            expect(stale).not.toMatch(/secret|private/);
            vi.setSystemTime(now + 6 * 3_600_000);
            h.timers[0].callback(h.cx);
            await h.settle();
            expect(text(h.mod.render())).not.toMatch(/Room North|Room South|Room East/);
            expect(text(h.mod.render())).toContain("stale");
            expect(h.effects.at(-1)).toEqual(["layout.resize", { id: "wintos-meetings", px: 28 }]);
            vi.setSystemTime(now);
            h.timers[0].callback(h.cx);
            await h.settle();
            expect(text(h.mod.render())).not.toContain("stale");
        }
    );
    test("a first response with backend-cached rooms and an error shows those rooms as stale", async () => {
        frozenClock();
        const h = host(async () => ok({ ...pair, updatedAt: now - 120_000, error: "private calendar configuration" }));
        await h.settle();
        const rendered = text(h.mod.render());
        expect(rendered).toContain("Room North");
        expect(rendered).toContain("Room South");
        expect(rendered).toContain("stale");
        expect(rendered).not.toContain("private");
    });
    test("backend-cached rooms survive a later error without cached data", async () => {
        frozenClock();
        const replies = [ok({ ...pair, error: "unavailable" }), ok({ meetings: [], error: "unavailable" })];
        const h = host(async () => replies.shift());
        await h.settle();
        h.timers[0].callback(h.cx);
        await h.settle();
        expect(text(h.mod.render())).toContain("Room North");
        expect(text(h.mod.render())).toContain("Room South");
        expect(text(h.mod.render())).toContain("stale");
    });
    test("a backend error refresh uses its full cached payload even after a successful response", async () => {
        frozenClock();
        const replies = [
            ok(pair),
            ok({ meetings: [meeting("Updated cached", 14, { room: "Room West" })], error: "private config" }),
        ];
        const h = host(async () => replies.shift());
        await h.settle();
        vi.setSystemTime(now + 3 * 3_600_000);
        h.timers[0].callback(h.cx);
        await h.settle();
        expect(text(h.mod.render())).toContain("Room West");
        expect(text(h.mod.render())).not.toMatch(/Room North|Room South|private/);
        expect(text(h.mod.render())).toContain("stale");
    });
    test("minute ticks reselect cached data while a fetch remains in flight", async () => {
        frozenClock();
        let request = 0;
        let finish!: (value: unknown) => void;
        const h = host(async () =>
            ++request === 1
                ? ok({ meetings: [...pair.meetings, meeting("Later cached", 14, { room: "Room East" })] })
                : new Promise((resolve) => {
                      finish = resolve;
                  })
        );
        await h.settle();
        h.timers[0].callback(h.cx);
        vi.setSystemTime(now + 3 * 3_600_000);
        h.timers[0].callback(h.cx);
        expect(text(h.mod.render())).toContain("Room East");
        expect(text(h.mod.render())).not.toMatch(/Room North|Room South/);
        expect(request).toBe(2);
        vi.setSystemTime(now + 6 * 3_600_000);
        h.timers[0].callback(h.cx);
        expect(text(h.mod.render())).not.toContain("Room East");
        expect(h.effects.at(-1)).toEqual(["layout.resize", { id: "wintos-meetings", px: 28 }]);
        finish({ ok: false });
        await h.settle();
        expect(text(h.mod.render())).toContain("stale");
    });
    test("first-load failure shows unavailable rather than an empty calendar", async () => {
        frozenClock();
        const h = host(async () => ok({ meetings: [], error: "private config" }));
        await h.settle();
        expect(text(h.mod.render())).toContain("Calendar unavailable");
        expect(text(h.mod.render())).not.toContain("No more meetings today");
    });
    test("overlapping minute ticks share the in-flight request", async () => {
        frozenClock();
        let finish!: (value: unknown) => void;
        const fetch = vi.fn(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                })
        );
        const h = host(fetch);
        h.timers[0].callback(h.cx);
        expect(fetch).toHaveBeenCalledTimes(1);
        finish(ok(pair));
        await h.settle();
        expect(text(h.mod.render())).toContain("Room South");
    });
});
