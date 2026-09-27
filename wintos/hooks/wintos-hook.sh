#!/bin/sh
# Forwards a Claude Code hook event to wintosd, tagged with the Wave tab and block it came
# from, and prints the daemon's answer (the prompt injection for UserPromptSubmit).
# Never fails and never waits long: a missing daemon must not slow Claude down.
[ -n "$WAVETERM_TABID" ] || exit 0
jq -c --arg t "$WAVETERM_TABID" --arg b "${WAVETERM_BLOCKID:-}" '{tabId: $t, blockId: $b, payload: .}' 2>/dev/null |
    curl -sf -m 0.2 -H "Content-Type: application/json" --data-binary @- "http://127.0.0.1:${WINTOS_PORT:-7730}/events" 2>/dev/null
exit 0
