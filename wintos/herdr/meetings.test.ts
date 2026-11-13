import { transformSync } from "esbuild";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, test, vi } from "vitest";
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
            { title: "Overnight", time: "Fri 13 Nov · 23:30 – 01:00", room: "Room North" },
            { title: "Morning", time: "09:00 – 10:00", room: "Room South" },
        ]);
    });
    test("formats compact local 24-hour times and weekdays without native locale support", () => {
        vi.spyOn(Date.prototype, "toLocaleTimeString").mockImplementation(() => "09:00:00 AM");
        vi.spyOn(Date.prototype, "toLocaleDateString").mockImplementation(() => "11/16/2026");
        expect(
            meetingRows(
                {
                    meetings: [
                        meeting("Monday", 9, {
                            start: iso(9, 0, 16),
                            end: iso(10, 0, 16),
                            room: "Room North",
                        }),
                    ],
                },
                now
            )[0]
        ).toEqual({
            title: "Monday",
            time: "Mon 16 Nov · 09:00 – 10:00",
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
    test("labels tomorrow after the last meeting and keeps chronological order", () => {
        const rows = meetingRows(
            {
                meetings: [
                    meeting("Ended", 8),
                    meeting("Tomorrow second", 12, { start: iso(12, 0, 14), end: iso(13, 0, 14) }),
                    meeting("Tomorrow first", 9, { start: iso(9, 0, 14), end: iso(10, 0, 14) }),
                    meeting("Later day", 9, { start: iso(9, 0, 15), end: iso(10, 0, 15) }),
                ],
            },
            now
        );
        expect(rows).toEqual([
            { title: "Tomorrow first", time: "Tomorrow · 09:00 – 10:00", room: "Room not listed" },
            { title: "Tomorrow second", time: "Tomorrow · 12:00 – 13:00", room: "Room not listed" },
        ]);
    });
    test("Friday after the last meeting shows Monday's next two meetings", () => {
        expect(
            meetingRows(
                {
                    meetings: [
                        meeting("Ended Friday", 8),
                        meeting("Monday second", 12, {
                            start: iso(12, 0, 16),
                            end: iso(13, 0, 16),
                            room: "Room South",
                        }),
                        meeting("Monday first", 9, { start: iso(9, 0, 16), end: iso(10, 0, 16), room: "Room North" }),
                    ],
                },
                now
            )
        ).toEqual([
            { title: "Monday first", time: "Mon 16 Nov · 09:00 – 10:00", room: "Room North" },
            { title: "Monday second", time: "Mon 16 Nov · 12:00 – 13:00", room: "Room South" },
        ]);
    });
    test("fills the remaining slot after today's last meeting with Monday", () => {
        expect(
            meetingRows(
                {
                    meetings: [
                        meeting("Today", 12),
                        meeting("Monday", 9, { start: iso(9, 0, 16), end: iso(10, 0, 16) }),
                    ],
                },
                now
            )
        ).toEqual([
            { title: "Today", time: "12:00 – 13:00", room: "Room not listed" },
            { title: "Monday", time: "Mon 16 Nov · 09:00 – 10:00", room: "Room not listed" },
        ]);
    });
    test("shows Monday then Tuesday when there is one meeting on each day", () => {
        expect(
            meetingRows(
                {
                    meetings: [
                        meeting("Tuesday", 9, { start: iso(9, 0, 17), end: iso(10, 0, 17) }),
                        meeting("Monday", 9, { start: iso(9, 0, 16), end: iso(10, 0, 16) }),
                    ],
                },
                now
            )
        ).toEqual([
            { title: "Monday", time: "Mon 16 Nov · 09:00 – 10:00", room: "Room not listed" },
            { title: "Tuesday", time: "Tue 17 Nov · 09:00 – 10:00", room: "Room not listed" },
        ]);
    });
    test("one representative per future start keeps accepted-first selection and skips duplicates", () => {
        const accepted = meeting("Accepted Monday", 9, { start: iso(9, 0, 16), end: iso(10, 0, 16) });
        expect(
            meetingRows(
                {
                    meetings: [
                        meeting("Pending Monday", 9, { start: iso(9, 0, 16), end: iso(10, 0, 16), reply: "pending" }),
                        accepted,
                        accepted,
                        meeting("Tuesday", 9, { start: iso(9, 0, 17), end: iso(10, 0, 17) }),
                    ],
                },
                now
            ).map((row) => row.title)
        ).toEqual(["Accepted Monday", "Tuesday"]);
    });
    test("stale payloads never resurrect expired Friday or Monday meetings", () => {
        const data = {
            error: "Calendar unavailable",
            updatedAt: now,
            meetings: [
                meeting("Expired Friday", 8),
                meeting("Expired Monday", 9, { start: iso(9, 0, 16), end: iso(10, 0, 16) }),
                meeting("Tuesday", 9, { start: iso(9, 0, 17), end: iso(10, 0, 17) }),
            ],
        };
        expect(meetingRows(data, new Date(2026, 10, 16, 12).getTime())).toEqual([
            { title: "Tuesday", time: "Tomorrow · 09:00 – 10:00", room: "Room not listed" },
        ]);
        expect(meetingRows(data, new Date(2026, 10, 17, 10).getTime())).toEqual([]);
        expect(meetingRows({ meetings: [] }, now)).toEqual([]);
    });
    test("current and imminent selection can each fill a second slot from future days", () => {
        const monday = meeting("Monday", 9, { start: iso(9, 0, 16), end: iso(10, 0, 16) });
        expect(
            meetingRows({ meetings: [meeting("Current", 9, { end: iso(11) }), monday] }, now).map((row) => row.title)
        ).toEqual(["Current", "Monday"]);
        expect(
            meetingRows(
                {
                    meetings: [
                        meeting("Current", 9, { end: iso(11) }),
                        meeting("Imminent", 10, { start: iso(10, 1) }),
                        monday,
                    ],
                },
                now
            ).map((row) => row.title)
        ).toEqual(["Imminent", "Monday"]);
    });
    test("fills a remaining slot with tomorrow and labels it independently of today", () => {
        expect(
            meetingRows(
                {
                    meetings: [
                        meeting("Today", 12),
                        meeting("Tomorrow", 9, { start: iso(9, 0, 14), end: iso(10, 0, 14) }),
                    ],
                },
                now
            )
        ).toEqual([
            { title: "Today", time: "12:00 – 13:00", room: "Room not listed" },
            { title: "Tomorrow", time: "Tomorrow · 09:00 – 10:00", room: "Room not listed" },
        ]);
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
                if (name === "gpui-base") return { v_flex: () => element("column") };
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
    test("fetches on init and every minute, renders separate nonshrinking room lines and resizes only its own slot", async () => {
        frozenClock();
        const fetch = vi.fn(async () => ok(pair));
        const h = host(fetch);
        await h.settle();
        expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:7732/meetings");
        expect(h.timers.map((t) => t.ms)).toEqual([60_000]);
        const tree = h.mod.render();
        expect(tree.styles.bg).toBe("chrome");
        expect((tree.children[0] as Element).styles.h).toBe(18);
        for (const room of ["Room North", "Room South"]) {
            const line = nodes(tree).find((n) => n.children.includes(room))!;
            expect(line).toBeDefined();
            expect(line.styles.flex_none).toBe(true);
            const row = nodes(tree).find((n) => n.children.includes(line))!;
            expect(row.kind).toBe("column");
            expect(row.styles.h).toBe(58);
            expect(row.styles.gap).toBe(2);
            expect(row.children.map((child: Element) => child.styles.h)).toEqual([16, 18, 18]);
            expect(
                row.children.some(
                    (n: any) =>
                        typeof n !== "string" &&
                        n.styles.truncate &&
                        text(n).includes(room === "Room North" ? "Planning" : "Review")
                )
            ).toBe(true);
        }
        expect(text(tree)).toContain("not accepted");
        expect(h.effects.at(-1)).toEqual(["layout.resize", { id: "wintos-meetings", px: 160 }]);
        h.timers[0].callback(h.cx);
        await h.settle();
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(h.notify).toHaveBeenCalled();
    });
    test("renders Monday and Tuesday labels from the real model and expires stale rows", async () => {
        frozenClock();
        const payload = {
            meetings: [
                meeting("Expired Friday", 8),
                meeting("Monday", 9, { start: iso(9, 0, 16), end: iso(10, 0, 16), room: "Room North" }),
                meeting("Tuesday", 9, { start: iso(9, 0, 17), end: iso(10, 0, 17), room: "Room South" }),
            ],
        };
        let request = 0;
        const h = host(async () => {
            if (++request === 1) return ok(payload);
            throw Error("Synthetic offline response");
        });
        await h.settle();
        expect(text(h.mod.render())).toContain("Mon 16 Nov · 09:00 – 10:00");
        expect(text(h.mod.render())).toContain("Tue 17 Nov · 09:00 – 10:00");
        expect(text(h.mod.render())).not.toContain("Expired Friday");
        vi.setSystemTime(new Date(2026, 10, 16, 12).getTime());
        h.timers[0].callback(h.cx);
        await h.settle();
        expect(text(h.mod.render())).not.toContain("Monday");
        expect(text(h.mod.render())).toContain("Tomorrow · 09:00 – 10:00");
        expect(text(h.mod.render())).toContain("Room South");
        expect(text(h.mod.render())).toContain("stale");
        vi.setSystemTime(new Date(2026, 10, 17, 10).getTime());
        h.timers[0].callback(h.cx);
        await h.settle();
        expect(text(h.mod.render())).not.toMatch(/Monday|Tuesday|Room North|Room South/);
    });
    test("shrinks for one and empty, distinguishing empty from unavailable", async () => {
        frozenClock();
        const replies = [ok({ meetings: [pair.meetings[0]] }), ok({ meetings: [] })];
        const h = host(async () => replies.shift());
        await h.settle();
        expect(h.effects.at(-1)).toEqual(["layout.resize", { id: "wintos-meetings", px: 100 }]);
        h.timers[0].callback(h.cx);
        await h.settle();
        expect(h.effects.at(-1)).toEqual(["layout.resize", { id: "wintos-meetings", px: 60 }]);
        expect(text(h.mod.render())).toContain("No upcoming meetings");
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
            expect(h.effects.at(-1)).toEqual(["layout.resize", { id: "wintos-meetings", px: 100 }]);
            expect(stale).toContain("stale");
            expect(stale).not.toMatch(/secret|private/);
            vi.setSystemTime(now + 6 * 3_600_000);
            h.timers[0].callback(h.cx);
            await h.settle();
            expect(text(h.mod.render())).not.toMatch(/Room North|Room South|Room East/);
            expect(text(h.mod.render())).toContain("stale");
            expect(h.effects.at(-1)).toEqual(["layout.resize", { id: "wintos-meetings", px: 60 }]);
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
        expect(h.effects.at(-1)).toEqual(["layout.resize", { id: "wintos-meetings", px: 60 }]);
        finish({ ok: false });
        await h.settle();
        expect(text(h.mod.render())).toContain("stale");
    });
    test("first-load failure shows unavailable rather than an empty calendar", async () => {
        frozenClock();
        const h = host(async () => ok({ meetings: [], error: "private config" }));
        await h.settle();
        expect(text(h.mod.render())).toContain("Calendar unavailable");
        expect(text(h.mod.render())).not.toContain("No upcoming meetings");
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
