import { describe, expect, test } from "vitest";
import { computeTheme } from "./termutil";

describe("computeTheme", () => {
    test("xterm's background stays invisible but keeps the theme's colour, which WebGL draws dim and italic glyphs on", () => {
        const config = { termthemes: { light: { background: "#fbfaf6" } } } as unknown as FullConfigType;
        const [theme, bg] = computeTheme(config, "light", 0.5);
        expect(theme.background).toBe("#fbfaf600");
        expect(bg).toBe("#fbfaf680");
    });
});

describe("computeTheme over the window's ground", () => {
    test("the hidden background is the colour the pane shows: the theme's at its opacity over the ground", () => {
        const config = { termthemes: { light: { background: "#fbfaf6" } } } as unknown as FullConfigType;
        expect(computeTheme(config, "light", 0.5, "#f3f0e9")[0].background).toBe("#f7f5f000");
        expect(computeTheme(config, "light", 0, "#f3f0e9")[0].background).toBe("#fbfaf600");
    });
});
