import { View, div } from "gpui-kit";
import { agents, focused, nextCommand, run, setShared, shared } from "herdr";

import { waitingAgents } from "./waiting.js";

export default class AttentionNavigation extends View {
    init(_props, cx) {
        this.loading = false;
        this.loadWaiting(cx);
        cx.timer.every(5000, (cx) => this.loadWaiting(cx));
        cx.spawn(async (cx) => {
            for (;;) {
                this.command(await nextCommand());
                cx.notify();
            }
        });
    }

    loadWaiting(cx) {
        if (this.loading) return;
        this.loading = true;
        cx.spawn(async (cx) => {
            try {
                const response = await fetch("http://127.0.0.1:7732/waiting");
                if (!response.ok) throw Error("Waiting status unavailable");
                const waits = await response.json();
                if (!Array.isArray(waits)) throw Error("Invalid waiting status");
                setShared("wintos.waiting", waits);
            } catch {
                setShared("wintos.waiting", []);
            } finally {
                this.loading = false;
                cx.notify();
            }
        });
    }

    command(command) {
        if (command !== "next" && command !== "prev") return;
        const list = waitingAgents(agents(), shared("wintos.waiting") ?? []);
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
