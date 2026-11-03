// WintOS's PRs page in Herdr (⇧⌘G): every PR that concerns you, grouped by what it asks of you.
// o goes back to the session that made the PR, live or resumed, so it can work the feedback.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, run, theme, props, closeOverlay, exec } from "herdr";
import { PORT } from "./config.js";
import { prPage, prGo, nextWorkingDayStart } from "./model.js";

const BASE = `http://127.0.0.1:${PORT}`;
const post = (path, body = {}) => fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export default class WintosPrs extends View {
    init(_props, cx) {
        this.state = null;
        this.at = 0;
        this.note = null;
        this.handle = cx.focus_handle();
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
        const rows = page ? [...page.groups.flatMap((g) => g.rows.map((r) => ({ ...r, snoozed: false }))), ...page.snoozed.map((r) => ({ ...r, snoozed: true }))] : [];
        this.at = Math.min(this.at, Math.max(0, rows.length - 1));
        const sel = rows[this.at];
        let i = -1;
        const line = (r) => {
            i++;
            const on = i === this.at;
            const index = i;
            return h_flex().id(`pr-${r.url}`).gap(10).px(10).py(6).rounded(8).items_center()
                .when(on, (el) => el.bg(t.selected))
                .hover((s) => s.bg(t.hover))
                .on_click((_e, cx) => { this.at = index; cx.notify(); })
                .child(div().w(70).flex_none().truncate().text_size(11.5).text_color(t.dim).child(`${r.repo} #${r.number}`))
                .child(v_flex().flex_1().min_w(0)
                    .child(div().truncate().text_color(r.snoozed ? t.dim : t.foreground).child(r.title))
                    .child(div().truncate().text_size(11).text_color(t.muted).child([r.author, r.why, r.owner ? `session: ${r.owner}${r.live ? "" : " (closed)"}` : r.project ? `project: ${r.project}` : ""].filter(Boolean).join(" · "))))
                .child(div().flex_none().text_size(11).text_color(r.late ? t.blocked : t.dim).child(r.age));
        };
        return v_flex().id("wintos-prs").track_focus(this.handle).size_full().p(16).gap(10).bg(t.popover).text_size(13).text_color(t.foreground)
            .on_key_down((e, cx) => {
                const k = e.key;
                if (k === "escape") return this.close();
                if (k === "j" || k === "down") this.at = Math.min(this.at + 1, rows.length - 1);
                else if (k === "k" || k === "up") this.at = Math.max(this.at - 1, 0);
                else if (k === "o" && sel) void this.go(sel);
                else if (k === "enter" && sel) void exec("open", [sel.url]);
                else if (k === "z" && sel) cx.spawn(async (cx) => { await this.snooze(sel, sel.snoozed); this.load(cx); });
                else if (k === "r") cx.spawn(async (cx) => { await post("/plugins/gh-prs/run"); this.load(cx); });
                else return;
                cx.stop_propagation();
                cx.notify();
            })
            .child(h_flex().items_center().gap(12)
                .child(div().flex_1().text_size(15).font_semibold().child("Pull requests"))
                .when(!!page, (el) => el.child(div().text_size(11.5).text_color(t.muted).child(`${page.counts.yours} yours · ${page.counts.waiting} waiting · ${page.counts.team} team`))))
            .child(div().text_size(11).text_color(t.dim).child("j k move · o its session · ⏎ in the browser · z snooze · r refresh · esc"))
            .when(!page, (el) => el.child(div().text_color(t.muted).child(this.note ?? "loading…")))
            .child(v_flex().id("pr-list").flex_1().min_h(0).overflow_y_scrollbar().gap(12)
                .children((page?.groups ?? []).map((g) => v_flex().gap(2)
                    .child(h_flex().gap(8).px(4).child(div().text_size(12).font_semibold().child(`${g.label} · ${g.rows.length}`)).child(div().text_size(11).text_color(t.dim).child(g.note)))
                    .children(g.rows.map((r) => line({ ...r, snoozed: false })))))
                .when((page?.snoozed.length ?? 0) > 0, (el) => el.child(v_flex().gap(2)
                    .child(div().px(4).text_size(12).font_semibold().text_color(t.muted).child(`Snoozed · ${page.snoozed.length}`))
                    .children(page.snoozed.map((r) => line({ ...r, snoozed: true }))))));
    }
}
