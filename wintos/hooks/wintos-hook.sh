#!/bin/sh
# Forwards a Claude Code hook event to wintosd, tagged with the Wave tab and block it came
# from, and prints the daemon's answer (the prompt injection for UserPromptSubmit).
# Never fails and never waits long: a missing daemon must not slow Claude down.
[ -n "$WAVETERM_TABID" ] || exit 0
payload="$(cat)"

# The block's init script is what Wave runs when the app starts, so pointing it at this
# session makes a quit-and-relaunch resume it. It is set on a prompt, not on SessionStart:
# Claude saves nothing to resume until the first prompt. Quitting WintOS ends sessions with
# reason "other"; only a deliberate exit clears the command.
# Only an interactive session you started owns its block: a `claude -p` run from inside it
# (CLAUDE_CODE_ENTRYPOINT=sdk-cli) inherits the block id and would otherwise make the next
# launch resume a throwaway session. CLAUDE_CODE_CHILD_SESSION can't tell them apart: Claude
# sets it for everything it spawns, the interactive session's own hooks included.
if [ -n "$WAVETERM_BLOCKID" ] && [ "${CLAUDE_CODE_ENTRYPOINT:-}" != "sdk-cli" ]; then
    wsh="${WAVETERM_WSHBINDIR:+$WAVETERM_WSHBINDIR/}wsh"
    case "$(printf '%s' "$payload" | jq -r '.hook_event_name + ":" + (.reason // "")' 2>/dev/null)" in
    UserPromptSubmit:*)
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

printf '%s' "$payload" | jq -c --arg t "$WAVETERM_TABID" --arg b "${WAVETERM_BLOCKID:-}" '{tabId: $t, blockId: $b, payload: .}' 2>/dev/null |
    curl -sf -m 0.2 -H "Content-Type: application/json" --data-binary @- "http://127.0.0.1:${WINTOS_PORT:-7730}/events" 2>/dev/null
exit 0
