#!/bin/sh
[ -n "${HC_TERMINAL_ID:-}" ] || exit 0
[ -z "${WAVETERM_TABID:-}" ] || exit 0
[ "${CLAUDE_CODE_ENTRYPOINT:-}" != sdk-cli ] || exit 0
[ "${CLAUDE_CODE_SESSION_KIND:-}" != bg ] || exit 0
terminal_pid=$(hc get "$HC_TERMINAL_ID" --json 2>/dev/null | jq -c '.foreground.pid | if type == "number" and . > 0 then . else null end' 2>/dev/null)
[ "$terminal_pid" != null ] && [ -n "$terminal_pid" ] || exit 0
p=$PPID
owner=""
while [ -n "$p" ] && [ "$p" -gt 1 ]; do
    case "$(ps -o command= -p "$p" 2>/dev/null | awk '{print $1}')" in
        claude | */claude | */claude/versions/*) owner=$p; break ;;
    esac
    p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
done
[ "$owner" = "$terminal_pid" ] || exit 0
jq -c --arg terminal "$HC_TERMINAL_ID" --arg config "${CLAUDE_CONFIG_DIR:-}" --arg launchDir "${CLAUDE_PROJECT_DIR:-}" --argjson terminalPid "$terminal_pid" '{terminal:$terminal,terminalPid:$terminalPid,configOverride:(if $config == "" then null else $config end),launchDir:$launchDir,payload:.} + (if $config == "" then {} else {configDir:$config} end)' |
    curl -sf -m 1 -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:7732/events >/dev/null 2>&1
exit 0
