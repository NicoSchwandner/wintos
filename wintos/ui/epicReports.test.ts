import { describe, expect, test } from "vitest";
import type { Session } from "../daemon/sessions/reduce";
import { GATHER_MS, reportDeliveries } from "./epicReports";

const agent = (more: Partial<Session> = {}): Session => ({ id: "ag", tabId: "t1", blockId: "b-ag", state: "idle", since: 0, lastAt: 0, ...more }) as Session;
const reports = { ag: [{ text: "Drafts mapping is done", at: 0 }, { text: "export waits on CI", at: 10 }] };

describe("reportDeliveries", () => {
    test("an idle agent in this tab gets all its reports as one line, once the first has waited a minute", () =>
        expect(reportDeliveries(reports, [agent()], "t1", GATHER_MS)).toEqual([{ agent: "ag", blockId: "b-ag", n: 2, text: "[WintOS report] Drafts mapping is done · export waits on CI" }]));
    test("too fresh: they wait for more", () => expect(reportDeliveries(reports, [agent()], "t1", GATHER_MS - 1)).toEqual([]));
    test("not while it works, not while you are in its pane, not from another tab's renderer", () => {
        expect(reportDeliveries(reports, [agent({ state: "working" })], "t1", GATHER_MS)).toEqual([]);
        expect(reportDeliveries(reports, [agent()], "t1", GATHER_MS, "b-ag")).toEqual([]);
        expect(reportDeliveries(reports, [agent()], "t2", GATHER_MS)).toEqual([]);
    });
    test("an agent whose pane is gone keeps its reports", () => expect(reportDeliveries(reports, [agent({ state: "ended" })], "t1", GATHER_MS)).toEqual([]));
});
