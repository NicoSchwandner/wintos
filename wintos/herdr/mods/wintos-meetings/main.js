import { h_flex, v_flex } from "gpui-base";
import { View, div } from "gpui-kit";
import { run, theme } from "herdr";
import { meetingRows } from "./model.js";

const RowHeight = 46;
const ThenHeight = 16;
const Gap = 4;
const Padding = 4;
const StatusHeight = 14;

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
        const count = this.rows.length;
        const height = count
            ? Padding * 2 + RowHeight + (count > 1 ? Gap + ThenHeight : 0) + (this.note ? StatusHeight + Gap : 0)
            : 28;
        run("layout.resize", { id: "wintos-meetings", px: height });
        cx.notify();
    }

    render() {
        const t = theme();
        const card = v_flex()
            .size_full()
            .px(16)
            .py(Padding)
            .gap(Gap)
            .bg(t.chrome)
            .text_size(12)
            .text_color(t.foreground);
        if (this.note)
            card.child(div().h(StatusHeight).flex_none().text_size(11).text_color(t.muted).truncate().child(this.note));
        for (const [index, row] of this.rows.entries()) {
            if (index > 0) {
                card.child(
                    h_flex()
                        .w_full()
                        .min_w(0)
                        .h(ThenHeight)
                        .flex_none()
                        .items_center()
                        .gap(Gap)
                        .child(
                            div()
                                .flex_none()
                                .text_size(11)
                                .text_color(t.muted)
                                .child(`Then ${row.time.split(" – ")[0]} ·`)
                        )
                        .child(div().flex_1().min_w(0).truncate().child(row.title))
                        .child(div().flex_none().child(`· ${row.room}`))
                );
                continue;
            }
            card.child(
                v_flex()
                    .w_full()
                    .min_w(0)
                    .h(RowHeight)
                    .flex_none()
                    .gap(0)
                    .child(div().h(14).flex_none().text_size(11).text_color(t.muted).truncate().child(row.time))
                    .child(div().h(16).flex_none().font_semibold().truncate().child(row.title))
                    .child(div().h(16).flex_none().truncate().child(row.room))
            );
        }
        if (!this.rows.length && !this.note)
            card.child(div().h(16).flex_none().text_color(t.muted).child("No more meetings today"));
        return card;
    }
}
