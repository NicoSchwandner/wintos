// WintOS in Herdr: the projects you drive, what waits on you, what runs and what is quiet,
// from Herdr's own wintosd. It also starts that daemon and types due wakes into their sessions.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, focused, run, theme, shared, setShared, setAgentOrder, nextCommand, exec } from "herdr";
import { CHECKOUT, PORT } from "./config.js";
import { sidebar, deliveries, relTime, focusLines, focusList, openWithNotes, toggleCheckbox } from "./model.js";

const BASE = `http://127.0.0.1:${PORT}`;
const post = (path, body = {}) => fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const TODAY_SHOWN = 6;
const LINE = { waiting: "your move", reply: "to read", running: "running" };

export default class WintOS extends View {
    init(_props, cx) {
        this.state = null;
        this.down = null;
        this.startedAt = 0;
        this.typing = new Set();
        cx.timer.every(2500, (cx) => this.refresh(cx));
        this.refresh(cx);
        cx.spawn(async (cx) => {
            for (;;) {
                const c = await nextCommand();
                await this.command(c);
                cx.notify();
            }
        });
    }

    refresh(cx) {
        cx.spawn(async (cx) => {
            try {
                const r = await fetch(`${BASE}/state`);
                this.state = await r.json();
                this.down = null;
                await this.deliver();
            } catch {
                this.down = "wintosd is starting…";
                await this.start();
            }
            cx.notify();
        });
    }

    // The daemon runs in a terminal of herdr-core's own, which outlives this window.
    async start() {
        if (Date.now() - this.startedAt < 60_000) return;
        this.startedAt = Date.now();
        await exec("hc", ["rm", "wintosd-herdr"]).catch(() => {});
        await exec("hc", ["run", "--bg", "--keep", "--no-notify", "--name", "wintosd-herdr", "--", `${CHECKOUT}/wintos/herdr/wintosd.sh`]).catch(() => {});
    }

    tabs() {
        return spaces().flatMap((s) => s.tabs.map((t) => ({ id: t.id, name: t.named ? t.name : s.tabs.length > 1 ? `${s.name} · ${t.name}` : s.name, space: s.id })));
    }

    // A due wake is typed only while its session is idle; the daemon hears of it once it went in.
    async deliver() {
        for (const d of deliveries(this.state, this.tabs().map((t) => t.id))) {
            if (this.typing.has(d.sessionId)) continue;
            this.typing.add(d.sessionId);
            try {
                if (d.kind === "type") {
                    const r = await exec("hc", ["send", "--if", "idle", d.blockId, d.text]);
                    if (r.code === 0) await post(`/wakes/${encodeURIComponent(d.id)}/delivered`);
                } else {
                    const pane = this.paneIn(d.tabId);
                    if (pane) run("pane.split", { direction: "right", pane, argv: ["/bin/sh", "-c", d.script] });
                }
            } finally {
                this.typing.delete(d.sessionId);
            }
        }
    }

    paneIn(tabId) {
        return panes().find((p) => p.tab === tabId && p.terminal)?.pane ?? null;
    }

    async command(c) {
        const tab = focused()?.tab?.id;
        if (!tab || !this.state) return;
        if (c === "drive") await post(`/projects/${encodeURIComponent(tab)}/drive`, { on: !(this.state.driving ?? []).includes(tab) });
        if (c === "snooze") {
            const until = (this.state.projectSnoozes?.[tab] ?? 0) > Date.now() ? null : nextWorkingDay();
            await post(`/projects/${encodeURIComponent(tab)}/snooze`, { until });
        }
        if (c === "quiet") setShared("wintos.quiet", !shared("wintos.quiet"));
    }

    open(tabId, target) {
        run("tab.select", { id: tabId });
        if (target?.blockId) run("pane.focus", { terminal: target.blockId });
    }

    render(_cx) {
        const t = theme();
        const root = v_flex().id("wintos").size_full().bg(t.chrome).text_size(12.5).text_color(t.foreground).overflow_y_scrollbar().px(10).py(8).gap(14);
        if (!this.state) return root.child(div().text_color(t.muted).child(this.down ?? "connecting to wintosd…"));
        const tabs = this.tabs();
        const names = Object.fromEntries(tabs.map((x) => [x.id, x.name]));
        const here = focused()?.tab?.id;
        const m = sidebar(this.state, tabs.map((x) => x.id), names, Date.now(), here);
        setAgentOrder(m.order);
        const showQuiet = !!shared("wintos.quiet");
        const queue = this.state.plugins?.["gh-prs"]?.data;
        const driving = (this.state.driving ?? []).includes(here);
        const snoozed = (this.state.projectSnoozes?.[here] ?? 0) > Date.now();
        // The mouse's way to what the keys do: the PRs page, and this project's drive and snooze.
        const bar = h_flex().gap(4).flex_wrap()
            .child(btn(t, "prs", "⇧⌘G", queue ? `PRs · ${m.prs.yours}${m.prs.late ? ` · ${m.prs.late} late` : ""}` : "PRs", () => run("mod.open", { name: "wintos-prs" })))
            .when(!!here, (el) => el
                .child(btn(t, "drive", "⌥⌘D", driving ? "stop driving" : "drive", () => this.command("drive")))
                .child(btn(t, "snooze", "⌥⌘Z", snoozed ? "wake" : "snooze", () => this.command("snooze"))));
        return root
            .child(bar)
            .when(!!this.state.day, (el) => el.child(this.today(t, this.state.day)))
            .when(m.driving.length > 0, (el) => el.child(this.section(t, "Driving", t.foreground, m.driving.map((d) => this.drive(t, d, here)))))
            .when(m.needs.length > 0, (el) => el.child(this.section(t, "Your move", t.blocked, m.needs.map((r) => this.card(t, r, here, t.blocked)))))
            .when(m.read.length > 0, (el) => el.child(this.section(t, "To read", t.done, m.read.map((r) => this.card(t, r, here, t.done)))))
            .when(m.running.length > 0, (el) => el.child(this.section(t, "Running", t.working, m.running.map((r) => this.quiet(t, r, here, t.working)))))
            .when(m.quiet.length > 0, (el) =>
                el.child(
                    v_flex().gap(2)
                        .child(h_flex().id("quiet-fold").justify_between().px(4).text_size(11.5).text_color(t.dim).hover((s) => s.text_color(t.muted))
                            .on_click(() => setShared("wintos.quiet", !showQuiet))
                            .child(`Quiet · ${m.quiet.length}`).child(showQuiet ? "fold" : "show"))
                        .children((showQuiet ? m.quiet : m.quiet.filter((r) => r.tabId === here)).map((r) => this.quiet(t, r, here, null)))));
    }

    // Today's plan from the journal: what is still open, a box to tick each, and its editor.
    today(t, day) {
        const items = focusList(day.focus);
        const open = openWithNotes(focusLines(day.focus));
        const done = items.filter((i) => i.done).length;
        // Herdr's daemon keeps its own record of planned days; a plan written in WintOS counts too.
        const planned = day.planned || items.length > 0;
        const edit = btn(t, "today-edit", "⇧⌘Y", planned ? "edit" : "plan", () => run("wintos-notes.today"));
        return v_flex().gap(5).px(11).py(9).rounded(9).bg(t.background).border(1).border_color(planned ? t.border : t.blocked)
            .child(h_flex().items_center().gap(8)
                .child(div().flex_1().font_semibold().child("Today"))
                .when(items.length > 0, (el) => el.child(div().text_size(11).text_color(t.dim).child(`${done} of ${items.length}`)))
                .child(edit))
            .when(!planned, (el) => el.child(div().text_color(t.blocked).child("Plan your day")))
            .when(planned && open.length === 0, (el) => el.child(div().text_color(t.muted).child(items.length ? `all ${items.length} done` : "nothing planned")))
            .children(open.slice(0, TODAY_SHOWN).map((i) => h_flex().id(`focus-${i.line}`).gap(8).items_center().pl(i.depth * 14)
                .child(i.note
                    ? div().w(4).h(4).mx(4).rounded(2).flex_none().bg(t.dim)
                    : div().id(`tick-${i.line}`).w(12).h(12).flex_none().rounded(3).border(1).border_color(i.done ? t.working : t.input).bg(i.done ? t.working : t.background)
                        .hover((s) => s.border_color(t.foreground))
                        .on_click((_e, cx) => cx.spawn(async (cx) => {
                            await post("/day/focus", { text: toggleCheckbox(day.focus, i.line), baseMtime: day.mtime });
                            this.refresh(cx);
                        })))
                .child(div().flex_1().truncate().text_color(i.done ? t.dim : t.foreground).child(i.text))))
            .when(open.length > TODAY_SHOWN, (el) => el.child(div().text_size(11).text_color(t.dim).child(`+${open.length - TODAY_SHOWN} more`)));
    }

    section(t, label, color, children) {
        return v_flex().gap(6).child(div().px(4).text_size(11.5).font_semibold().text_color(color).child(label)).children(children);
    }

    frame(t, id, active) {
        return v_flex().id(id).gap(5).px(11).py(9).rounded(9).bg(active ? t.selected : t.background).border(1).border_color(active ? t.input : t.border).hover((s) => s.bg(t.hover));
    }

    title(t, v) {
        return h_flex().gap(8).justify_between()
            .child(div().flex_1().truncate().font_semibold().child(v?.title ?? "Untitled"))
            .child(div().flex_none().text_size(11).text_color(t.dim).child(v?.age ?? ""));
    }

    drive(t, d, here) {
        const waiting = d.lines.filter((l) => l.state === "waiting");
        const now = Date.now();
        return this.frame(t, `drive-${d.tabId}`, d.tabId === here)
            .on_click(() => this.open(d.tabId, d.target))
            .child(this.title(t, d.view))
            .when(waiting.length > 0, (el) => el.child(div().text_color(t.blocked).child(`${waiting.length} waiting on you · ${relTime(now - Math.min(...waiting.map((l) => l.since)))}`)))
            .when(d.lines.length === 0, (el) => el.child(div().text_color(t.muted).child("nothing waiting or running")))
            .children(d.lines.map((l) => h_flex().id(`line-${l.sessionId}`).gap(8).items_center()
                .on_click(() => this.open(d.tabId, { blockId: l.blockId }))
                .child(div().w(6).h(6).rounded(3).flex_none().bg(l.state === "waiting" ? t.blocked : l.state === "reply" ? t.done : t.working))
                .child(div().flex_1().truncate().text_color(t.muted).child(l.name))
                .child(div().flex_none().text_size(11).text_color(t.dim).child(l.state === "running" ? LINE[l.state] : `${LINE[l.state]} · ${relTime(now - l.since)}`))))
            .child(div().text_size(10.5).text_color(t.dim).child(`today · ${d.today}`));
    }

    card(t, r, here, color) {
        return this.frame(t, `row-${r.tabId}`, r.tabId === here)
            .on_click(() => this.open(r.tabId, r.target))
            .child(this.title(t, r.view))
            .when(!!r.view?.next, (el) => el.child(div().text_color(color).child(cut(r.view.next, 140))))
            .when(!!r.view?.done, (el) => el.child(div().text_color(t.working).child(`✓ ${r.view.done}`)));
    }

    quiet(t, r, here, dot) {
        return h_flex().id(`quiet-${r.tabId}`).gap(8).items_center().px(10).py(5).rounded(7)
            .when(r.tabId === here, (el) => el.bg(t.selected))
            .hover((s) => s.bg(t.hover))
            .on_click(() => this.open(r.tabId, r.target))
            .when(!!dot, (el) => el.child(div().w(6).h(6).rounded(3).flex_none().bg(dot)))
            .child(div().flex_1().truncate().child(r.view?.title ?? "Untitled"))
            .child(div().flex_none().max_w(140).truncate().text_size(11).text_color(r.view?.done ? t.working : t.dim).child(r.view?.done ? `✓ ${r.view.done}` : (r.view?.next ?? r.view?.reason ?? "")));
    }
}

// A button with its key beside it, as WintOS shows every action.
function btn(t, id, key, label, onClick) {
    return h_flex().id(`btn-${id}`).gap(5).px(7).py(2).rounded(6).items_center().border(1).border_color(t.border).bg(t.background)
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { void onClick(); cx.notify(); })
        .child(div().text_size(10.5).text_color(t.dim).child(key))
        .child(div().text_size(11.5).text_color(t.foreground).child(label));
}

const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function nextWorkingDay() {
    const d = new Date();
    do d.setDate(d.getDate() + 1);
    while (d.getDay() === 0 || d.getDay() === 6);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}
