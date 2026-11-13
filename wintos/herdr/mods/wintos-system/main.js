import { h_flex } from "gpui-base";
import { div, View } from "gpui-kit";
import { theme } from "herdr";

const Endpoint = "http://127.0.0.1:7732/system";
const GiB = 1024 ** 3;

export default class SystemStatus extends View {
    init(_props, cx) {
        this.data = {};
        this.loading = false;
        this.load(cx);
        cx.timer.every(5000, (cx) => this.load(cx));
    }

    load(cx) {
        if (this.loading) return;
        this.loading = true;
        cx.spawn(async (cx) => {
            try {
                const response = await fetch(Endpoint);
                if (!response.ok) throw Error("System usage unavailable");
                this.data = (await response.json()) ?? {};
            } catch {
                this.data = {};
            } finally {
                this.loading = false;
                cx.notify();
            }
        });
    }

    render() {
        const t = theme();
        const cpu = this.data.cpu;
        const cpuText = Number.isFinite(cpu) && cpu >= 0 && cpu <= 100 ? `${Math.round(cpu)}%` : "—";
        const memory = this.data.memory;
        const memoryText = memory && Number.isFinite(memory.used) && Number.isFinite(memory.total) &&
            memory.total > 0 && memory.used >= 0 && memory.used <= memory.total
            ? `${(memory.used / GiB).toFixed(1)}/${Number((memory.total / GiB).toFixed(1))} GiB`
            : "—";
        return h_flex()
            .id("wintos-system")
            .size_full()
            .items_center()
            .px(16)
            .bg(t.chrome)
            .child(div().text_size(11).text_color(t.muted).child(`CPU ${cpuText} · RAM ${memoryText}`));
    }
}
