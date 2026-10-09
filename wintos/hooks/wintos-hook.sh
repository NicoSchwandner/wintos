#!/bin/sh
# Forwards a Claude Code hook event to wintosd, tagged with the Wave tab and block it came
# from, and prints the daemon's answer (the prompt injection for UserPromptSubmit).
# Never fails and never waits long: a missing daemon must not slow Claude down.
[ -n "$WAVETERM_TABID" ] || exit 0
payload="$(cat)"

# The block's init script is what Wave runs when the app starts, so pointing it at this
# session makes a quit-and-relaunch resume it. It is set on a prompt, not on a new session's
# start: Claude saves nothing to resume until the first prompt. A resumed one is saved already. Quitting WintOS ends sessions with
# reason "other"; only a deliberate exit clears the command.
# Only an interactive session you started owns its block: a `claude -p` run from inside it
# (CLAUDE_CODE_ENTRYPOINT=sdk-cli) inherits the block id and would otherwise make the next
# launch resume a throwaway session. CLAUDE_CODE_CHILD_SESSION can't tell them apart: Claude
# sets it for everything it spawns, the interactive session's own hooks included.
if [ -n "$WAVETERM_BLOCKID" ] && [ "${CLAUDE_CODE_ENTRYPOINT:-}" != "sdk-cli" ]; then
    wsh="${WAVETERM_WSHBINDIR:+$WAVETERM_WSHBINDIR/}wsh"
    case "$(printf '%s' "$payload" | jq -r '.hook_event_name + ":" + (.reason // .source // "")' 2>/dev/null)" in
    UserPromptSubmit:* | SessionStart:resume)
        # Transcripts are keyed by the launch directory; the payload's cwd follows the session.
        # A session of another Claude account (its own CLAUDE_CONFIG_DIR) resumes in that
        # account; without one, none is set, as setting it even to the default switches keychains.
        resume="$(printf '%s' "$payload" | jq -r --arg dir "${CLAUDE_PROJECT_DIR:-}" --arg cfg "${CLAUDE_CONFIG_DIR:-}" '(@sh "cd \(if $dir != "" then $dir else .cwd end)") + " && " + (if $cfg != "" then (@sh "CLAUDE_CONFIG_DIR=\($cfg)") + " " else "" end) + (@sh "claude --resume \(.session_id)")' 2>/dev/null)"
        [ -n "$resume" ] && "$wsh" setmeta -b "$WAVETERM_BLOCKID" "cmd:initscript=$resume" >/dev/null 2>&1
        ;;
    SessionEnd:prompt_input_exit | SessionEnd:logout)
        "$wsh" setmeta -b "$WAVETERM_BLOCKID" "cmd:initscript=" >/dev/null 2>&1
        ;;
    esac
fi

# A Bash call (PostToolUse) only matters when it was a gh pr command: then the PRs it named, by
# link or by number and repo, become the session's. The rest of the call never leaves here.
if [ "$(printf '%s' "$payload" | jq -r '.hook_event_name' 2>/dev/null)" = "PostToolUse" ]; then
    payload="$(printf '%s' "$payload" | jq -c '
        (.tool_input.command // "") as $c
        | select($c | test("(^|[;&|(\\s])gh pr (create|edit|ready|merge|comment|view|checks|review|close|reopen)\\b"))
        | ([$c, (.tool_response | tostring)] | join(" ") | [scan("https://github\\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pull/[0-9]+")])
          + ([($c | capture("gh pr [a-z]+ (?<n>[0-9]+)\\b")), ($c | capture("(-R|--repo)[ =](?<r>[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)"))] | if length == 2 then ["https://github.com/\(.[1].r)/pull/\(.[0].n)"] else [] end)
        | unique as $prs | select($prs | length > 0)
        | {hook_event_name: "PostToolUse", session_id: $ARGS.named.p.session_id, cwd: $ARGS.named.p.cwd, prs: $prs}' --argjson p "$payload" 2>/dev/null)"
    [ -n "$payload" ] || exit 0
fi

printf '%s' "$payload" | jq -c --arg t "$WAVETERM_TABID" --arg b "${WAVETERM_BLOCKID:-}" '{tabId: $t, blockId: $b, payload: .}' 2>/dev/null |
    curl -sf -m 0.2 -H "Content-Type: application/json" --data-binary @- "http://127.0.0.1:${WINTOS_PORT:-7730}/events" 2>/dev/null
exit 0
