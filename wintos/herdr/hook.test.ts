import { execFileSync } from "child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { expect, test } from "vitest";

function run(extra: Record<string, string>) {
    const temp = mkdtempSync(join(tmpdir(), "herdr-hook-"));
    writeFileSync(join(temp, "curl"), '#!/bin/sh\ncat > "$CAPTURE"\n', { mode: 0o755 });
    writeFileSync(
        join(temp, "hc"),
        `#!/bin/sh
echo '{"foreground":{"pid":101}}'
`,
        { mode: 0o755 }
    );
    const capture = join(temp, "received.json");
    execFileSync("/bin/sh", [join(__dirname, "hook.sh")], {
        env: { PATH: `${temp}:${process.env.PATH}`, HOME: temp, CAPTURE: capture, ...extra },
        input: JSON.stringify({
            session_id: "synthetic-session",
            hook_event_name: "UserPromptSubmit",
            cwd: "/tmp/example",
            prompt: "Review https://github.com/acme/api/pull/42",
        }),
        timeout: 5000,
    });
    return existsSync(capture) ? JSON.parse(readFileSync(capture, "utf8")) : null;
}
test("registers the Herdr terminal, session and Claude account with the companion", () => {
    expect(run({ HC_TERMINAL_ID: "t7", CLAUDE_CONFIG_DIR: "/tmp/account" })).toMatchObject({
        terminal: "t7",
        terminalPid: 101,
        configDir: "/tmp/account",
        payload: { session_id: "synthetic-session", cwd: "/tmp/example" },
    });
});
test.each([
    {},
    { HC_TERMINAL_ID: "t7", WAVETERM_TABID: "wave" },
    { HC_TERMINAL_ID: "t7", CLAUDE_CODE_ENTRYPOINT: "sdk-cli" },
    { HC_TERMINAL_ID: "t7", CLAUDE_CODE_SESSION_KIND: "bg" },
])("ignores other apps and inherited background terminal ids (%j)", (env) => expect(run(env)).toBeNull());
