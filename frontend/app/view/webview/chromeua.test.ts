import { expect, test } from "vitest";
import { chromeUserAgent } from "./chromeua";

test("the pane names itself plain Chrome, not Electron or the app", () =>
    expect(chromeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Wave(Dev)/0.14.5 Chrome/146.0.7680.166 Electron/41.1.0 Safari/537.36")).toBe(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.7680.166 Safari/537.36"
    ));
