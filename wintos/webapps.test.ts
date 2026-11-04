import { describe, expect, test } from "vitest";
import { appFor, launchArgs } from "./webapps";

const meet = { id: "abc", startUrl: "https://meet.example.com/landing?x=2", profile: "Profile 2" };

describe("appFor", () => {
    test("a link on the app's site goes to the app", () => expect(appFor([meet], "https://meet.example.com/xyz-abcd-efg")).toBe(meet));
    test("a link elsewhere opens in the browser", () => expect(appFor([meet], "https://calendar.example.com/event")).toBeUndefined());
    test("a link that isn't https, or isn't a url, never matches", () => {
        expect(appFor([meet], "http://meet.example.com/xyz")).toBeUndefined();
        expect(appFor([meet], "not a url")).toBeUndefined();
    });
});

test("Chrome opens the link in that app, in the profile that installed it", () =>
    expect(launchArgs(meet, "https://meet.example.com/xyz")).toEqual([
        "-na",
        "Google Chrome",
        "--args",
        "--profile-directory=Profile 2",
        "--app-id=abc",
        "--app-launch-url-for-shortcuts-menu-item=https://meet.example.com/xyz",
    ]));
