#!/bin/sh
# PreToolUse on Bash: a push, comment or review on a PR another live session owns is refused,
# naming that session and the ways out (wintos tell --pr, wintos pr --took-over, or
# WINTOS_NOT_MINE=1 for one command). Works in any Claude session, in WintOS or not. Never
# blocks when it can't tell: no daemon, a slow answer, or a PR it doesn't know go through.
port="${WINTOS_PORT:-7730}"
payload="$(cat)"
command="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)"
case "$command" in
*push* | *"gh pr comment"* | *"gh pr review"*) ;;
*) exit 0 ;;
esac
body="$(printf '%s' "$payload" | jq -c '{command: .tool_input.command, cwd: .cwd, session_id: .session_id}' 2>/dev/null)" || exit 0
out="$(printf '%s' "$body" | curl -s -m 3 -w '\n%{http_code}' -H 'Content-Type: application/json' --data-binary @- "http://127.0.0.1:$port/prs/guard" 2>/dev/null)" || exit 0
code="$(printf '%s' "$out" | tail -n 1)"
[ "$code" = 409 ] || exit 0
printf '%s' "$out" | sed '$d' | jq -Rsc '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: rtrimstr("\n")}}'
exit 0
