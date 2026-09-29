import { describe, expect, test } from "vitest";
import { opensNewPane } from "./links";

describe("opensNewPane", () => {
    test("a GitHub page linking to another site opens a new pane beside it", () => {
        expect(opensNewPane("https://github.com/acme/api/pull/7", "https://app.clickup.com/t/abc")).toBe(true);
    });

    test("navigation within GitHub stays in place", () => {
        expect(opensNewPane("https://github.com/acme/api/pull/7", "https://github.com/acme/api/pull/7/files")).toBe(false);
    });

    test("any other page navigates in place, so login redirects are never torn apart", () => {
        expect(opensNewPane("https://status.example.com/login", "https://login.example.org/sso")).toBe(false);
    });

    test("only web pages count", () => {
        expect(opensNewPane("https://github.com/acme/api", "mailto:a@example.com")).toBe(false);
        expect(opensNewPane("not a url", "https://example.com")).toBe(false);
    });
});
