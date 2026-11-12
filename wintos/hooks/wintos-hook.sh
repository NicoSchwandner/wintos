#!/bin/sh
# Forwards a Claude Code hook event to wintosd, tagged with the Wave tab and block it came
# from, and prints the daemon's answer (the prompt injection for UserPromptSubmit).
# Never fails and never waits long: a missing daemon must not slow Claude down.
port="${WINTOS_PORT:-7730}"
[ -n "$WAVETERM_TABID" ] || exit 0
# A headless `claude -p` run started from inside a session inherits its pane but is part of that
# session's work: shown as a session of its own it has no pane to open, and one cut off (the Mac
# asleep) stays "working" for good.
[ "${CLAUDE_CODE_ENTRYPOINT:-}" = "sdk-cli" ] && exit 0
payload="$(cat)"

# The block's init script is what Wave runs when the app starts, so pointing it at this
# session makes a quit-and-relaunch resume it. It is set on a prompt, not on a new session's
# start: Claude saves nothing to resume until the first prompt. A resumed one is saved already. Quitting WintOS ends sessions with
# reason "other"; only a deliberate exit clears the command.
# Only an interactive session you started owns its block: a fork Claude Code runs in the
# background (CLAUDE_CODE_SESSION_KIND=bg) inherits the pane's id too, and would otherwise make
# the next launch resume it. CLAUDE_CODE_CHILD_SESSION can't tell them apart: Claude sets it for
# everything it spawns, the interactive session's own hooks included.
# Claude's background service runs sessions with CLAUDE_CODE_SESSION_KIND=bg, inheriting the
# pane's id. Its spares are started ahead of any fork and never get a conversation: until a
# background session has a transcript, it is one of them, and stays unreported. A fork resumed
# in a pane runs in the pane's own Claude, without the variable, and owns the pane like any session.
background="${CLAUDE_CODE_SESSION_KIND:-}"
# Not every Claude that has the pane's id runs in the pane. Claude's background service keeps the
# id of the pane it was first started from, and so does everything it runs, its own hooks for a
# background session included, some without the variable above. A Claude in the pane is on the
# pane's terminal; any other one is in the background, wherever its id says it is.
if [ -n "$WAVETERM_BLOCKID" ] && [ -n "${TMUX:-}" ] && [ "$background" != "bg" ]; then
    pane_tty="$(tmux display -p -t "w-$WAVETERM_BLOCKID" '#{pane_tty}' 2>/dev/null)"
    if [ -n "$pane_tty" ]; then
        # The hook itself has no terminal: the nearest ancestor that has one is its Claude.
        p=$PPID own=""
        while [ -n "$p" ] && [ "$p" -gt 1 ]; do
            t="$(ps -o tty= -p "$p" 2>/dev/null | tr -d ' ')"
            case "$t" in "" | "??" | "?") ;; *) own="/dev/$t"; break ;; esac
            p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')"
        done
        [ "$own" = "$pane_tty" ] || background="bg"
    fi
fi
if [ "$background" = "bg" ]; then
    transcript="$(printf '%s' "$payload" | jq -r '.transcript_path // empty' 2>/dev/null)"
    [ -n "$transcript" ] && [ -s "$transcript" ] || exit 0
fi
resume=""
if [ -n "$WAVETERM_BLOCKID" ] && [ "$background" != "bg" ]; then
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

# A question to the developer mid-turn (AskUserQuestion, ExitPlanMode) waits on them until it is
# answered: its start and end go to the daemon, and for AskUserQuestion its first question and
# options, so the decision card can show them; nothing else of the call does.
case "$(printf '%s' "$payload" | jq -r '.hook_event_name + ":" + (.tool_name // "")' 2>/dev/null)" in
PreToolUse:AskUserQuestion)
    payload="$(printf '%s' "$payload" | jq -c '{hook_event_name, session_id, cwd, tool_name}
        + ((.tool_input.questions[0] // {}) as $q | {question: {text: ($q.question // ""), options: [($q.options // [])[:4][] | {label: (.label // ""), then: (.description // "")}]}})' 2>/dev/null)" ;;
PreToolUse:ExitPlanMode | PostToolUse:AskUserQuestion | PostToolUse:ExitPlanMode)
    payload="$(printf '%s' "$payload" | jq -c '{hook_event_name, session_id, cwd, tool_name}' 2>/dev/null)" ;;
esac

# A Bash call (PostToolUse) only matters when it was a gh pr command, or a gh api call that writes
# to a PR (a review or comment posted that way): then the PRs it named, by link or by number and
# repo, are touched by the session (the daemon ignores a view, which only reads), and a create or
# ready moves its lane. So does a PR a script opened (ws-pr.sh, rules-pr.sh): they print its link
# on a line of its own after "PR: ". A link merely printed (a file, a listing) is no PR of the
# session's. The rest of the call never leaves here.
if [ "$(printf '%s' "$payload" | jq -r '.hook_event_name + ":" + (.tool_name // "")' 2>/dev/null)" = "PostToolUse:Bash" ]; then
    payload="$(printf '%s' "$payload" | jq -c '
        (.tool_input.command // "") as $c
        | "https://github\\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pull/[0-9]+" as $url
        # Each gh pr command of a compound one by itself, so a number and a repo pair only within one.
        | [$c | splits("[;&|\n]+") | capture("(^|[\\s(])gh pr (?<v>create|edit|ready|merge|comment|review|close|reopen|view|checks)\\b(?<rest>.*)")
            | .rest as $r | {v, named: ([$r | scan($url)] + ([($r | capture("^\\s+(?<n>[0-9]+)\\b")), ($r | capture("(-R|--repo)[ =](?<r>[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)"))] | if length == 2 then ["https://github.com/\(.[1].r)/pull/\(.[0].n)"] else [] end))}] as $gh
        # Acting on a PR claims it; reading one (view, checks) never does, nor does a link in the output,
        # but for the one gh pr create prints.
        | [$gh[] | select(.v != "view" and .v != "checks")] as $acts
        | [$c | scan("gh api [^;&|]*") | select(test("\\s(-[fF]|--field|--raw-field|--input|(-X|--method)[ =]?(POST|PATCH|PUT))(\\s|=|$)")) | capture("repos/(?<r>[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)/pulls/(?<n>[0-9]+)") | "https://github.com/\(.r)/pull/\(.n)"] as $written
        | [(.tool_response.stdout? // "") | strings | split("\n")[] | capture("^\\s*PR: (?<u>https://github\\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pull/[0-9]+)\\s*$") | .u] as $landed
        | (if any($acts[]; .v == "create") then [(.tool_response.stdout? // "") | strings | scan($url)] else [] end) as $created
        | select(($gh | length > 0) or ($written | length > 0) or ($landed | length > 0))
        | (if ($acts | length > 0) then [$acts[].named[]] else [$gh[].named[]] end) + $created + $written + $landed
        | unique as $prs
        | ((if any($acts[]; .v == "create") or ($landed | length > 0) then "create" else ($acts[0].v // null) end) // (if ($gh | length > 0) then "view" else null end)) as $verb
        | select(($prs | length > 0) or $verb)
        | {hook_event_name: "PostToolUse", session_id: $ARGS.named.p.session_id, cwd: $ARGS.named.p.cwd, prs: $prs}
          + if $verb then {pr_verb: $verb} else {} end' --argjson p "$payload" 2>/dev/null)"
    [ -n "$payload" ] || exit 0
fi

# What the session is told rides on the answer to these two: given 1 s, as a slow answer past
# 0.2 s dropped the rules without a trace. Every other event is fire and forget.
wait=0.2
case "$(printf '%s' "$payload" | jq -r '.hook_event_name' 2>/dev/null)" in
UserPromptSubmit | SessionStart) wait=1 ;;
esac
# The resume command goes along: it tells the daemon this is the session the pane runs now.
# The config dir too: its plugin store holds this account's heads-ups.
printf '%s' "$payload" | jq -c --arg t "$WAVETERM_TABID" --arg b "${WAVETERM_BLOCKID:-}" --arg r "$resume" --arg k "$background" --arg c "${CLAUDE_CONFIG_DIR:-$HOME/.claude}" '{tabId: $t, blockId: $b, payload: (. + (if $r != "" then {resume: $r} else {} end) + (if $k == "bg" then {kind: "bg"} else {} end) + {config_dir: $c})}' 2>/dev/null |
    curl -sf -m "$wait" -H "Content-Type: application/json" --data-binary @- "http://127.0.0.1:$port/events" 2>/dev/null
exit 0
