import { describe, expect, test } from "vitest";
import { guardTarget, repoOfRemote } from "./guard";

describe("guardTarget", () => {
    test("a push: the refspec's branch, else the checkout's, in the directory it runs in", () => {
        expect(guardTarget("git push")).toEqual({ kind: "push" });
        expect(guardTarget("git push -u origin feature/x")).toEqual({ kind: "push", branch: "feature/x" });
        expect(guardTarget("git push origin HEAD:refs/heads/fix")).toEqual({ kind: "push", branch: "fix" });
        expect(guardTarget("cd /w/wt && git add a && git commit -m x && git push")).toEqual({ kind: "push", dir: "/w/wt" });
        expect(guardTarget("git -C '/w/my wt' push origin b")).toEqual({ kind: "push", branch: "b", dir: "/w/my wt" });
    });

    test("a comment or review: by link, or by number and repo", () => {
        expect(guardTarget('gh pr comment https://github.com/o/r/pull/7 --body "x"')).toEqual({ kind: "comment", url: "https://github.com/o/r/pull/7" });
        expect(guardTarget("gh pr review 7 -R o/r --approve")).toEqual({ kind: "comment", number: 7, repo: "o/r" });
        expect(guardTarget("cd /w && gh pr comment 7 --body x")).toEqual({ kind: "comment", number: 7, dir: "/w" });
    });

    test("WINTOS_NOT_MINE=1 lets one command through; other commands are none of its business", () => {
        expect(guardTarget("WINTOS_NOT_MINE=1 git push")).toBeUndefined();
        expect(guardTarget("gh pr view 7")).toBeUndefined();
        expect(guardTarget("git status")).toBeUndefined();
    });

    test("repoOfRemote reads https and ssh remotes", () => {
        expect(repoOfRemote("https://github.com/WintDev/Core.git\n")).toBe("WintDev/Core");
        expect(repoOfRemote("git@github.com:WintDev/Wint.HeartMcp.git")).toBe("WintDev/Wint.HeartMcp");
    });
});
