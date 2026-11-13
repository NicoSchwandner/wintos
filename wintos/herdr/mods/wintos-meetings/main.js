import { v_flex } from "gpui-base";
import { View, div } from "gpui-kit";
import { run, theme } from "herdr";
import { meetingRows } from "./model.js";

export default class Meetings extends View {
    init(_props, cx) {
        this.rows = [];
        this.note = "Loading meetings…";
        this.cache = null;
        this.loading = false;
        this.load(cx);
        cx.timer.every(60_000, (cx) => this.load(cx));
    }

    load(cx) {
        this.refresh(cx);
        if (this.loading) return;
        this.loading = true;
        cx.spawn(async (cx) => {
            try {
                const response = await fetch("http://127.0.0.1:7732/meetings");
                if (!response.ok) throw Error("Calendar unavailable");
                const data = await response.json();
                if (!data || typeof data !== "object" || !("meetings" in data) || !Array.isArray(data.meetings))
                    throw Error("Calendar unavailable");
                if ("error" in data && data.error) {
                    if (data.meetings.length) this.cache = data;
                    throw Error("Calendar unavailable");
                }
                this.cache = data;
                this.note = null;
            } catch {
                this.note = this.cache ? "Calendar unavailable · stale" : "Calendar unavailable";
            } finally {
                this.loading = false;
            }
            this.refresh(cx);
        });
    }

    refresh(cx) {
        this.rows = this.cache ? meetingRows(this.cache, Date.now()) : [];
        run("layout.resize", { id: "wintos-meetings", px: this.rows.length ? 40 + this.rows.length * 60 : 60 });
        cx.notify();
    }

    render() {
        const t = theme();
        const card = v_flex().size_full().px(16).py(8).gap(2).bg(t.chrome).text_size(12).text_color(t.foreground);
        card.child(
            div()
                .h(18)
                .flex_none()
                .text_size(11)
                .text_color(t.muted)
                .truncate()
                .child(this.note || "Meetings")
        );
        for (const row of this.rows) {
            card.child(
                v_flex()
                    .w_full()
                    .min_w(0)
                    .h(58)
                    .flex_none()
                    .gap(2)
                    .child(
                        div()
                            .h(16)
                            .flex_none()
                            .text_size(11)
                            .text_color(t.muted)
                            .truncate()
                            .child(`${row.time}${row.unaccepted ? " · not accepted" : ""}`)
                    )
                    .child(div().h(18).flex_none().font_semibold().truncate().child(row.title))
                    .child(div().h(18).flex_none().truncate().child(row.room))
            );
        }
        if (!this.rows.length && !this.note)
            card.child(div().h(18).flex_none().text_color(t.muted).child("No upcoming meetings"));
        return card;
    }
}
