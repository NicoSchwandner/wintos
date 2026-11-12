#!/bin/sh
[ -n "${HC_TERMINAL_ID:-}" ] || exit 0
[ -z "${WAVETERM_TABID:-}" ] || exit 0
[ "${CLAUDE_CODE_ENTRYPOINT:-}" != sdk-cli ] || exit 0
[ "${CLAUDE_CODE_SESSION_KIND:-}" != bg ] || exit 0
terminal_pid=$(hc get "$HC_TERMINAL_ID" --json 2>/dev/null | jq -c '.foreground.pid | if type == "number" and . > 0 then . else null end' 2>/dev/null)
[ -n "$terminal_pid" ] || terminal_pid=null
jq -c --arg terminal "$HC_TERMINAL_ID" --arg config "${CLAUDE_CONFIG_DIR:-$HOME/.claude}" --argjson terminalPid "$terminal_pid" '{terminal:$terminal,terminalPid:$terminalPid,configDir:$config,payload:.}' |
    curl -sf -m 1 -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:7732/events >/dev/null 2>&1
exit 0
