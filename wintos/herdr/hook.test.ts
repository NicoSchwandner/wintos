import { execFileSync } from "child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { expect, test } from "vitest";

function run(extra: Record<string, string>, ancestor = "101") {
    const temp = mkdtempSync(join(tmpdir(), "herdr-hook-"));
    try {
        writeFileSync(join(temp, "curl"), '#!/bin/sh\ncat > "$CAPTURE"\n', { mode: 0o755 });
        writeFileSync(join(temp, "hc"), `#!/bin/sh\necho '{"foreground":{"pid":101,"argv":["claude"]}}'\n`, {
            mode: 0o755,
        });
        writeFileSync(
            join(temp, "ps"),
            `#!/bin/sh
case "$2" in
command=) if [ "$4" = "$SYNTHETIC_CLAUDE_PID" ]; then echo /tmp/claude; else echo /bin/sh; fi ;;
ppid=) echo "$SYNTHETIC_CLAUDE_PID" ;;
tty=) echo ttys001 ;;
esac
`,
            { mode: 0o755 }
        );
        const capture = join(temp, "received.json");
        const stdout = execFileSync("/bin/sh", [join(__dirname, "hook.sh")], {
            env: {
                PATH: `${temp}:${process.env.PATH}`,
                HOME: temp,
                CAPTURE: capture,
                SYNTHETIC_CLAUDE_PID: ancestor,
                ...extra,
            },
            input: JSON.stringify({
                session_id: "synthetic-session",
                hook_event_name: "UserPromptSubmit",
                cwd: "/tmp/changed-directory",
                prompt: "Review https://github.com/acme/api/pull/42",
            }),
            encoding: "utf8",
            timeout: 5000,
        });
        return { body: existsSync(capture) ? JSON.parse(readFileSync(capture, "utf8")) : null, stdout };
    } finally {
        rmSync(temp, { recursive: true, force: true });
    }
}
test("registers only the emitting foreground Claude and preserves its launch directory", () => {
    const result = run({
        HC_TERMINAL_ID: "t7",
        CLAUDE_CONFIG_DIR: "/tmp/account",
        CLAUDE_PROJECT_DIR: "/tmp/launch-directory",
    });
    expect(result.body).toMatchObject({
        terminal: "t7",
        terminalPid: 101,
        configDir: "/tmp/account",
        configOverride: "/tmp/account",
        launchDir: "/tmp/launch-directory",
        payload: { session_id: "synthetic-session", cwd: "/tmp/changed-directory" },
    });
    expect(result.stdout).toBe("");
});
test("background Claude inheriting terminal identity cannot emit as its foreground parent, even on the same tty", () => {
    expect(run({ HC_TERMINAL_ID: "t7" }, "202")).toEqual({ body: null, stdout: "" });
});
test("default account leaves its configuration override unset", () => {
    const result = run({ HC_TERMINAL_ID: "t7" });
    expect(result.body.configDir).toBeUndefined();
    expect(result.body.configOverride).toBeNull();
    expect(result.stdout).toBe("");
});
test("an explicit default-looking account path remains an explicit override", () => {
    expect(run({ HC_TERMINAL_ID: "t7", CLAUDE_CONFIG_DIR: "/tmp/custom/.claude" }).body.configOverride).toBe(
        "/tmp/custom/.claude"
    );
});
test.each([
    {},
    { HC_TERMINAL_ID: "t7", WAVETERM_TABID: "wave" },
    { HC_TERMINAL_ID: "t7", CLAUDE_CODE_ENTRYPOINT: "sdk-cli" },
    { HC_TERMINAL_ID: "t7", CLAUDE_CODE_SESSION_KIND: "bg" },
])("ignores other apps and inherited marked background ids (%j)", (env) => expect(run(env).body).toBeNull());
