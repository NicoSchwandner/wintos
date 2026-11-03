// WintOS's PRs page in Herdr (⇧⌘G): every PR that concerns you, grouped by what it asks of you.
// o goes back to the session that made the PR, live or resumed, so it can work the feedback.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, run, theme, props, closeOverlay, exec, settings } from "herdr";
import { PORT } from "./config.js";
import { prPage, prGo, nextWorkingDayStart } from "./model.js";

const HEAD = 32;
const ROW = 46;
const BASE = `http://127.0.0.1:${PORT}`;
const post = (path, body = {}) => fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export default class WintosPrs extends View {
    init(_props, cx) {
        this.state = null;
        this.at = 0;
        this.note = null;
        this.handle = cx.focus_handle();
        this.scroll = 0;
        this.height = 500;
        this.follow = false;
        this.handle.focus();
        cx.timer.after(300, () => this.handle.focus());
        this.load(cx);
        cx.timer.every(15000, (cx) => this.load(cx));
    }

    load(cx) {
        cx.spawn(async (cx) => {
            try {
                this.state = await (await fetch(`${BASE}/state`)).json();
            } catch {
                this.note = "wintosd isn't answering";
            }
            cx.notify();
        });
    }

    tabIds() {
        return spaces().flatMap((s) => s.tabs.map((t) => t.id));
    }

    close() {
        closeOverlay(props().overlay);
    }

    // The session that made the PR: its terminal, or resumed beside its project's panes, or in a
    // tab of its own when the project's tab is gone; a PR no project knows starts one.
    async go(row) {
        const g = prGo(this.state, this.tabIds(), row.url);
        if (g.kind === "terminal") {
            run("tab.select", { id: g.tabId });
            run("pane.focus", { terminal: g.terminal });
        } else if (g.kind === "tab") run("tab.select", { id: g.tabId });
        else if (g.kind === "resume" && g.open) {
            run("tab.select", { id: g.tabId });
            run("pane.split", { direction: "right", argv: ["/bin/sh", "-c", g.script] });
        } else {
            const args = g.kind === "resume" ? ["--name", row.project ?? `#${row.number}`, "--argv", JSON.stringify(["/bin/sh", "-c", g.script])] : ["--name", `${row.repo} #${row.number}`, "--argv", JSON.stringify(["claude"]), "--task", row.url];
            const r = await exec("herdr-app", ["do", "tab.new", ...args]);
            const made = r.code === 0 ? JSON.parse(r.stdout) : null;
            // The closed project's notes and sessions follow it into the new tab.
            if (g.kind === "resume" && made?.tab) await post(`/projects/${encodeURIComponent(g.tabId)}/reopen`, { tabId: made.tab });
        }
        this.close();
    }

    async snooze(row, snoozed) {
        await post("/prs/snooze", snoozed ? { url: row.url, until: null } : { url: row.url, until: nextWorkingDayStart(Date.now()), movedAt: row.movedAt });
    }

    render(_cx) {
        const t = theme();
        const page = this.state ? prPage(this.state, this.tabIds(), Date.now()) : undefined;
        // One list of headers and rows; j/k move over the rows and keep the chosen one in view.
        const items = [];
        const rows = [];
        for (const g of page?.groups ?? []) {
            items.push({ head: `${g.label} · ${g.rows.length}`, note: g.note });
            for (const r of g.rows) items.push({ row: { ...r, snoozed: false }, at: rows.push(r) - 1 });
        }
        if (page?.snoozed.length) {
            items.push({ head: `Snoozed · ${page.snoozed.length}`, note: "back the next working day, or when it moves" });
            for (const r of page.snoozed) items.push({ row: { ...r, snoozed: true }, at: rows.push({ ...r, snoozed: true }) - 1 });
        }
        this.at = Math.min(this.at, Math.max(0, rows.length - 1));
        const sel = items.find((x) => x.row && x.at === this.at)?.row;
        // Laid out by hand, as Herdr's picker is: each item at its top, scrolled by j/k and the wheel.
        const tops = [];
        let y = 0;
        for (const x of items) (tops.push(y), (y += x.head ? HEAD : ROW));
        const maxScroll = Math.max(0, y - this.height);
        const selTop = tops[items.findIndex((x) => x.row && x.at === this.at)] ?? 0;
        if (this.follow) {
            if (selTop < this.scroll) this.scroll = Math.max(0, selTop - HEAD);
            if (selTop + ROW > this.scroll + this.height) this.scroll = selTop + ROW - this.height;
            this.follow = false;
        }
        this.scroll = Math.max(0, Math.min(this.scroll, maxScroll));
        const move = (to) => {
            this.at = Math.max(0, Math.min(to, rows.length - 1));
            this.follow = true;
        };
        const act = {
            go: () => sel && void this.go(sel),
            open: () => sel && void exec("open", [sel.url]),
            snooze: (cx) => sel && cx.spawn(async (cx) => { await this.snooze(sel, sel.snoozed); this.load(cx); }),
            refresh: (cx) => cx.spawn(async (cx) => { await post("/plugins/gh-prs/run"); this.load(cx); }),
        };
        const item = (i) => {
            const x = items[i];
            if (x.head) return h_flex().w_full().h(HEAD).items_end().gap(8).px(4).pb(4).child(div().text_size(12).font_semibold().child(x.head)).child(div().text_size(11).text_color(t.dim).child(x.note));
            const r = x.row;
            const on = x.at === this.at;
            return h_flex().id(`pr-${r.url}`).w_full().h(ROW).gap(10).px(10).rounded(8).items_center()
                .when(on, (el) => el.bg(t.selected))
                .hover((s) => s.bg(t.hover))
                .on_click((_e, cx) => { this.at = x.at; cx.notify(); })
                .child(div().w(84).flex_none().truncate().text_size(11.5).text_color(t.dim).child(`${r.repo} #${r.number}`))
                .child(v_flex().flex_1().min_w(0)
                    .child(div().truncate().text_color(r.snoozed ? t.dim : t.foreground).child(r.title))
                    .child(div().truncate().text_size(11).text_color(t.muted).child([r.author, r.why, r.owner ? `session: ${r.owner}${r.live ? "" : " (closed)"}` : r.project ? `project: ${r.project}` : ""].filter(Boolean).join(" · "))))
                .when(on, (el) => el.child(h_flex().flex_none().gap(4)
                    .child(btn(t, "go", "o", r.owner ? "its session" : r.project ? "its project" : "new session", act.go))
                    .child(btn(t, "open", "⏎", "browser", act.open))
                    .child(btn(t, "snooze", "z", r.snoozed ? "wake" : "snooze", act.snooze))))
                .when(!on, (el) => el.child(div().flex_none().text_size(11).text_color(r.late ? t.blocked : t.dim).child(r.age)));
        };
        return v_flex().id("wintos-prs").track_focus(this.handle).size_full().p(16).gap(10).bg(t.popover).text_size(13).text_color(t.foreground)
            .on_key_down((e, cx) => {
                const k = e.key;
                if (k === "escape") return this.close();
                if (k === "j" || k === "down") move(this.at + 1);
                else if (k === "k" || k === "up") move(this.at - 1);
                else if (k === "o") act.go();
                else if (k === "enter") act.open();
                else if (k === "z") act.snooze(cx);
                else if (k === "r") act.refresh(cx);
                else return;
                cx.stop_propagation();
                cx.notify();
            })
            .child(h_flex().items_center().gap(8)
                .child(div().flex_1().text_size(15).font_semibold().child("Pull requests"))
                .when(!!page, (el) => el.child(div().text_size(11.5).text_color(t.muted).child(`${page.counts.yours} yours · ${page.counts.waiting} waiting · ${page.counts.team} team`)))
                .child(btn(t, "refresh", "r", "refresh", act.refresh))
                .child(btn(t, "close", "esc", "close", () => this.close())))
            .when(!page, (el) => el.child(div().text_color(t.muted).child(this.note ?? "loading…")))
            .when(!!page, (el) => el.child(div().id("pr-list").relative().flex_1().min_h(0).w_full().overflow_hidden()
                .on_size_change((size, cx) => { this.height = size.height / (settings().zoom ?? 1); cx.notify(); })
                .on_scroll_wheel((e, cx) => { this.scroll = Math.max(0, Math.min(this.scroll - e.delta.y, maxScroll)); cx.notify(); })
                .children(items.map((x, i) => (tops[i] + (x.head ? HEAD : ROW) > this.scroll && tops[i] < this.scroll + this.height ? div().absolute().left(0).right(0).top(tops[i] - this.scroll).h(x.head ? HEAD : ROW).child(item(i)) : null)).filter(Boolean))))
    }
}

// A button with its key beside it, as WintOS shows every action.
function btn(t, id, key, label, onClick) {
    return h_flex().id(`btn-${id}`).gap(5).px(7).py(2).rounded(6).items_center().border(1).border_color(t.border).bg(t.background)
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { onClick(cx); cx.notify(); })
        .child(div().text_size(10.5).text_color(t.dim).child(key))
        .child(div().text_size(11.5).text_color(t.foreground).child(label));
}
