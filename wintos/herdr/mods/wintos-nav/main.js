import { View, div } from "gpui-kit";
import { agents, focused, nextCommand, run } from "herdr";

export default class AttentionNavigation extends View {
    init(_props, cx) {
        cx.spawn(async (cx) => {
            for (;;) {
                this.command(await nextCommand());
                cx.notify();
            }
        });
    }

    command(command) {
        if (command !== "next" && command !== "prev") return;
        const list = agents();
        const current = list.findIndex((a) => a.address === focused()?.terminal);
        const direction = command === "prev" ? -1 : 1;
        const start = current < 0 ? (direction === 1 ? -1 : 0) : current;
        for (let offset = 1; offset <= list.length; offset++) {
            const at = (start + direction * offset + list.length) % list.length;
            if (at === current) continue;
            const a = list[at];
            if (a.status === "blocked" || a.status === "done") {
                run("agent.focus", { terminal: a.address });
                return;
            }
        }
    }

    render() {
        return div();
    }
}
