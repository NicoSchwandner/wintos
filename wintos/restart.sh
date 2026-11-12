#!/bin/bash
# Restarts the WintOS running from this checkout and proves it: builds, stops it, starts it,
# and waits until a new daemon and window answer. Fails loudly instead of leaving the old one
# running, which a pkill that matched nothing would.
#   wintos/restart.sh            the everyday instance (debug port 9223, daemon 7730)
#   wintos/restart.sh --dev      the dev instance (dev-instance.sh: 9224, 7731)
set -euo pipefail
cd "$(dirname "$0")/.."
DEBUG_PORT="${WINTOS_DEBUG_PORT:-9223}"
DAEMON_PORT="${WINTOS_PORT:-7730}"
LOG="${WINTOS_LOG:-/tmp/wintos.log}"
START=wintos/dev.sh
if [ "${1:-}" = --dev ]; then DEBUG_PORT=9224 DAEMON_PORT=7731 LOG=/tmp/wintos-dev.log START=wintos/dev-instance.sh; fi

fail() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
ok() { printf '  ✓ %s\n' "$*"; }
# electron-vite is started with --remoteDebuggingPort N, Electron with --remote-debugging-port=N.
running() { pgrep -f "remoteDebuggingPort $DEBUG_PORT|remote-debugging-port=$DEBUG_PORT" || true; }

# Built before anything stops: a checkout that doesn't build leaves the running WintOS alone,
# instead of leaving nothing running (⌥⌘U on a broken commit did). Sessions run on in tmux.
# A cleaned cache can take node_modules with it: put it back rather than fail to build.
if [ ! -x node_modules/.bin/electron-vite ]; then
    npm ci --no-audit --no-fund >/dev/null || fail "npm ci failed; WintOS keeps running as it was"
    ok "dependencies reinstalled"
fi
task build:server:quickdev >/dev/null || fail "the server doesn't build; WintOS keeps running as it was"
ok "server built"
node wintos/build.mjs >/dev/null || fail "the daemon or CLI doesn't build; WintOS keeps running as it was"
ok "daemon built"

old="$(running | tr '\n' ' ')"
if [ -n "$old" ]; then
    pkill -f "remoteDebuggingPort $DEBUG_PORT" || true
    pkill -f "remote-debugging-port=$DEBUG_PORT" || true
    for _ in $(seq 1 30); do [ -z "$(running)" ] && break; sleep 0.5; done
    left="$(running | tr '\n' ' ')"
    [ -z "$left" ] || fail "WintOS on port $DEBUG_PORT did not stop (still running: $left). Quit it with ⌘Q, or kill -9 $left, then run this again."
    ok "stopped (was $old)"
fi


started="$(date +%s)"
nohup "$START" >"$LOG" 2>&1 &
for _ in $(seq 1 90); do
    curl -s -m 1 "http://127.0.0.1:$DAEMON_PORT/state" >/dev/null 2>&1 && curl -s -m 1 "http://127.0.0.1:$DEBUG_PORT/json/list" 2>/dev/null | grep -q '"page"' && break
    sleep 1
done
curl -s -m 1 "http://127.0.0.1:$DAEMON_PORT/state" >/dev/null 2>&1 || fail "the daemon does not answer on port $DAEMON_PORT after 90 s; see $LOG"
curl -s -m 1 "http://127.0.0.1:$DEBUG_PORT/json/list" 2>/dev/null | grep -q '"page"' || fail "no window answers on port $DEBUG_PORT after 90 s; see $LOG"
# What answers must be the one just started, not one that survived.
pid="$(pgrep -f "remoteDebuggingPort $DEBUG_PORT" | head -1)"
[ -n "$pid" ] || fail "WintOS answers, but nothing runs with --remoteDebuggingPort $DEBUG_PORT; see $LOG"
# Only here, not exported: WintOS inherits this environment, and LC_ALL=C in its shells makes
# pbcopy read UTF-8 as Mac Roman. ps and date must speak English month and day names.
born="$(LC_ALL=C date -j -f '%a %b %d %T %Y' "$(LC_ALL=C ps -o lstart= -p "$pid" | xargs)" +%s)"
[ "$born" -ge "$started" ] || fail "an older WintOS (pid $pid) still answers; quit it and run this again"
ok "running (pid $pid), log in $LOG"
