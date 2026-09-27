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
if [ -n "$WAVETERM_BLOCKID" ]; then
    wsh="${WAVETERM_WSHBINDIR:+$WAVETERM_WSHBINDIR/}wsh"
    case "$(printf '%s' "$payload" | jq -r '.hook_event_name + ":" + (.reason // "")' 2>/dev/null)" in
    UserPromptSubmit:*)
        resume="$(printf '%s' "$payload" | jq -r '@sh "cd \(.cwd) && claude --resume \(.session_id)"' 2>/dev/null)"
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
