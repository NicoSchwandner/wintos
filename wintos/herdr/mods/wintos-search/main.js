import { h_flex, Input, InputState, ScrollHandle, v_flex } from "gpui-base";
import { div, View } from "gpui-kit";
import { closeOverlay, props, theme } from "herdr";

const BASE = "http://127.0.0.1:7732";

export default class SessionSearch extends View {
    init(_props, cx) {
        this.query = "";
        this.sequence = 0;
        this.rows = [];
        this.at = 0;
        this.note = null;
        this.scroll = ScrollHandle.new();
        this.input = InputState.new({ placeholder: "PR URL, repo#number, or session name…" });
        this.input.on("change", (_e, cx) => {
            this.query = this.input.value();
            this.sequence++;
            this.rows = [];
            this.at = 0;
            cx.notify();
            const query = this.query;
            cx.timer.after(180, (cx) => {
                if (query === this.query) this.load(cx);
            });
        });
        this.input.on("submit", (_e, cx) => void this.go(this.rows[this.at], cx));
        this.handle = cx.focus_handle();
        this.load(cx);
        this.input.focus();
        cx.timer.after(100, () => this.input.focus());
    }

    load(cx) {
        const sequence = ++this.sequence;
        cx.spawn(async (cx) => {
            try {
                const response = await fetch(`${BASE}/search?q=${encodeURIComponent(this.query)}`);
                if (!response.ok) throw Error("Search failed");
                const rows = await response.json();
                if (sequence !== this.sequence) return;
                this.rows = rows;
                this.at = 0;
                this.note = null;
                this.scroll?.scroll_to_item(0);
            } catch {
                if (sequence !== this.sequence) return;
                this.note = "The session companion is unavailable. Its background service may need restarting.";
            }
            cx.notify();
        });
    }

    async go(row, cx) {
        if (!row || this.opening) return;
        this.opening = true;
        try {
            const response = await fetch(`${BASE}/open`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: row.id }),
            });
            if (response.ok) closeOverlay(props().overlay);
            else this.note = (await response.json()).error ?? "Could not open the conversation.";
        } catch {
            this.note = "The session companion is unavailable.";
        } finally {
            this.opening = false;
            cx.notify();
        }
    }

    render() {
        const t = theme();
        return v_flex()
            .id("session-search")
            .track_focus(this.handle)
            .w_full()
            .h(480)
            .p(18)
            .gap(10)
            .bg(t.popover)
            .text_size(13)
            .text_color(t.foreground)
            .on_key_down((e, cx) => {
                if (e.key === "escape") closeOverlay(props().overlay);
                else if (e.key === "down" || (e.key === "j" && e.modifiers.control))
                    this.at = Math.min(this.at + 1, Math.max(0, this.rows.length - 1));
                else if (e.key === "up" || (e.key === "k" && e.modifiers.control)) this.at = Math.max(this.at - 1, 0);
                else return;
                this.scroll.scroll_to_item(this.at);
                cx.stop_propagation();
                cx.notify();
            })
            .child(
                h_flex()
                    .items_center()
                    .gap(10)
                    .child(div().flex_1().text_size(15).font_semibold().child("Find a conversation"))
                    .child(
                        div()
                            .id("close-search")
                            .text_size(11)
                            .text_color(t.dim)
                            .hover((el) => el.text_color(t.foreground))
                            .on_click(() => closeOverlay(props().overlay))
                            .child("esc · close")
                    )
            )
            .child(
                div()
                    .h(36)
                    .flex_none()
                    .px(10)
                    .rounded(9)
                    .border(1)
                    .border_color(t.accent)
                    .bg(t.background)
                    .child(Input.new(this.input).size_full().text_size(13).text_color(t.foreground))
            )
            .when(!!this.note, (el) => el.child(div().text_color(t.blocked).child(this.note)))
            .child(
                v_flex()
                    .id("session-search-results")
                    .flex_1()
                    .min_h(0)
                    .overflow_y_scrollbar()
                    .track_scroll(this.scroll)
                    .gap(3)
                    .children(
                        this.rows.map((r, i) =>
                            h_flex()
                                .id(`session-${r.id}`)
                                .gap(10)
                                .px(10)
                                .py(8)
                                .rounded(8)
                                .items_center()
                                .when(i === this.at, (el) => el.bg(t.selected))
                                .hover((el) => el.bg(t.hover))
                                .on_click((_e, cx) => void this.go(r, cx))
                                .child(
                                    v_flex()
                                        .flex_1()
                                        .min_w(0)
                                        .child(div().truncate().child(r.name))
                                        .child(
                                            div()
                                                .truncate()
                                                .text_size(11)
                                                .text_color(t.muted)
                                                .child(
                                                    (r.prs ?? [])
                                                        .map((p) =>
                                                            p.replace("https://github.com/", "").replace("/pull/", "#")
                                                        )
                                                        .join(" · ") ||
                                                        r.cwd ||
                                                        ""
                                                )
                                        )
                                )
                                .child(
                                    div()
                                        .text_size(11)
                                        .text_color(t.dim)
                                        .child(r.live ? "open" : "resume")
                                )
                        )
                    )
                    .when(this.rows.length === 0 && !this.note, (el) =>
                        el.child(
                            div()
                                .p(10)
                                .text_color(t.muted)
                                .child("No conversations found. Try a PR URL or repository and number.")
                        )
                    )
            )
            .child(
                div()
                    .text_size(11)
                    .text_color(t.dim)
                    .child(
                        this.opening
                            ? "Opening…"
                            : "↑ ↓ choose · ⏎ or click opens · live and saved WintOS / Herdr sessions"
                    )
            );
    }
}
