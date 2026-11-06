// WintOS's notes in Herdr: mine.md of the tab you are in, the only file you write, and today's
// plan from your daily journal. Read as markdown; ⌘E edits in place, ⌘⏎ saves, esc discards.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, Textarea, TextareaState, TextView } from "gpui-base";
import { focused, spaces, theme, shared, setShared, nextCommand, run } from "herdr";
import { PORT } from "./config.js";

const BASE = `http://127.0.0.1:${PORT}`;
const post = (path, body) => fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const VIEWS = [
    { id: "mine", label: "mine.md", key: "⌘E" },
    { id: "today", label: "Today", key: "⇧⌘Y" },
];

export default class WintosNotes extends View {
    init(_props, cx) {
        this.tab = null;
        this.mine = null; // { text, mtime } of this.tab
        this.day = null;
        this.editing = null; // { view, tab, base, editor }
        this.note = null;
        cx.timer.every(3000, (cx) => this.load(cx));
        this.load(cx);
        cx.spawn(async (cx) => {
            for (;;) {
                const c = await nextCommand();
                await this.command(c, cx);
                cx.notify();
            }
        });
    }

    view() {
        return shared("wintos.notes") === "today" ? "today" : "mine";
    }

    load(cx) {
        cx.spawn(async (cx) => {
            const tab = focused()?.tab ?? null;
            try {
                const state = await (await fetch(`${BASE}/state`)).json();
                this.day = state.day ?? null;
                const r = tab ? await fetch(`${BASE}/projects/${encodeURIComponent(tab)}/notes`) : null;
                this.mine = r?.ok ? await r.json().then((n) => ({ text: n.mine, mtime: n.mineMtime })) : { text: "", mtime: 0 };
                this.tab = tab;
            } catch {
                this.note = "wintosd isn't answering";
            }
            cx.notify();
        });
    }

    async command(c, cx) {
        if (c === "mine" || c === "today") {
            setShared("wintos.notes", c);
            run("layout.show", { id: "notes" });
            return this.edit(c, cx);
        }
        if (c === "save") return this.save(cx);
        if (c === "discard") this.stop();
    }

    edit(view, cx) {
        if (this.editing) return;
        const text = view === "today" ? (this.day?.focus ?? "") : (this.mine?.text ?? "");
        const editor = TextareaState.new({ value: text });
        editor.set_soft_wrap(true);
        // ⌘⏎ is the textarea's own submit (Enter alone is a new line), so it never reaches the panel.
        editor.on("submit", (e, cx) => {
            if (!e?.secondary) return;
            void this.save(cx);
            cx.notify();
        });
        this.editing = { view, tab: this.tab, base: view === "today" ? this.day?.mtime : this.mine?.mtime, editor };
        this.note = null;
        editor.focus();
        cx.timer.after(50, () => editor.focus());
        cx.notify();
    }

    stop() {
        this.editing?.editor.release();
        this.editing = null;
    }

    // A save that finds the file changed since you began keeps your text and says so.
    async save(cx) {
        const e = this.editing;
        if (!e?.tab && e?.view === "mine") return void (this.note = "No tab to save mine.md for.");
        if (!e) return;
        const text = e.editor.value();
        let r;
        if (e.view === "today") r = await post("/day/focus", { text, baseMtime: e.base });
        else {
            r = await post(`/projects/${encodeURIComponent(e.tab)}/mine`, { text, baseMtime: e.base || undefined });
            // A tab no session has named yet has no project: it gets one, called as Herdr calls the tab.
            if (r.status === 404) {
                const name = spaces().flatMap((s) => s.tabs).find((x) => x.id === e.tab)?.name ?? "Untitled";
                await post(`/projects/${encodeURIComponent(e.tab)}/title`, { title: name, manual: false });
                r = await post(`/projects/${encodeURIComponent(e.tab)}/mine`, { text });
            }
        }
        if (r.ok) this.stop();
        else this.note = r.status === 409 ? "Changed on disk since you began: copy your text, esc, and edit again." : `Not saved (${r.status}).`;
        this.load(cx);
    }

    render(_cx) {
        const t = theme();
        const view = this.editing?.view ?? this.view();
        const text = view === "today" ? (this.day?.focus ?? "") : (this.mine?.text ?? "");
        const empty = view === "today" ? (this.day ? "Nothing planned yet. ⇧⌘Y writes one to three things that matter today." : "No journal: set WINTOS_JOURNAL_DIR.") : "Nothing in mine.md yet. ⌘E writes it.";
        return v_flex().id("wintos-notes").size_full()
            // ⌘⏎ and esc reach here from the textarea, whatever the key bindings say.
            .on_key_down((e, cx) => {
                if (!this.editing) return;
                if (e.key === "enter" && e.modifiers.platform) void this.save(cx);
                else if (e.key === "escape") this.stop();
                else return;
                cx.stop_propagation();
                cx.notify();
            }).bg(t.chrome).text_size(13).text_color(t.foreground).border_l(1).border_color(t.border)
            .child(h_flex().flex_none().gap(4).px(10).py(8).items_center()
                .children(VIEWS.map((v) => h_flex().id(`view-${v.id}`).gap(5).px(8).py(3).rounded(6).items_center()
                    .when(v.id === view, (el) => el.bg(t.selected))
                    .hover((s) => s.bg(t.hover))
                    .on_click((_e, cx) => { if (!this.editing) { setShared("wintos.notes", v.id); cx.notify(); } })
                    .child(div().text_size(10.5).text_color(t.dim).child(v.key))
                    .child(div().text_size(12.5).child(v.label))))
                .child(div().flex_1())
                .child(this.editing
                    ? h_flex().gap(4).child(btn(t, "save", "⌘⏎", "save", (cx) => this.save(cx))).child(btn(t, "discard", "esc", "discard", (cx) => (this.stop(), cx.notify())))
                    : btn(t, "edit", view === "today" ? "⇧⌘Y" : "⌘E", "edit", (cx) => this.edit(view, cx))))
            .when(!!this.note, (el) => el.child(div().px(12).pb(6).text_size(11.5).text_color(t.blocked).child(this.note)))
            .child(this.editing
                ? div().flex_1().min_h(0).px(10).pb(10).child(Textarea.new(this.editing.editor).size_full().text_size(13))
                : div().id("notes-read").flex_1().min_h(0).px(14).pb(12).overflow_y_scrollbar()
                    .child(text.trim() ? TextView.markdown(`notes-${view}-${this.tab}`, text) : div().text_color(t.muted).child(empty)));
    }
}

function btn(t, id, key, label, onClick) {
    return h_flex().id(`btn-${id}`).gap(5).px(7).py(2).rounded(6).items_center().border(1).border_color(t.border).bg(t.background)
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { void onClick(cx); cx.notify(); })
        .child(div().text_size(10.5).text_color(t.dim).child(key))
        .child(div().text_size(11.5).child(label));
}
