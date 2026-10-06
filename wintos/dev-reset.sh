#!/bin/bash
# The dev instance from a clean slate: stops it, wipes its Wave data, projects and journal (its
# config stays), lays down a fixture journal with yesterday's plan, starts it and seeds T1-T3.
# Run before an e2e pass, and whenever ad hoc checks have left panes lying around.
set -euo pipefail
cd "$(dirname "$0")/.."
D="$HOME/.local/share/wintos-dev"
pkill -f "remoteDebuggingPort 9224" || true
pkill -f "remote-debugging-port=9224" || true
for _ in $(seq 1 20); do pgrep -f "remote-debugging-port=9224" >/dev/null || break; sleep 0.5; done
rm -rf "$D/data" "$D/projects" "$D/journal"
mkdir -p "$D/journal/templates"
cp wintos/e2e/fixtures/daily_template.md "$D/journal/templates/"
Y=$(date -v-1d +%Y-%m-%d)
mkdir -p "$D/journal/days/${Y:0:4}/${Y:5:2}"
cp wintos/e2e/fixtures/yesterday.md "$D/journal/days/${Y:0:4}/${Y:5:2}/$Y.md"
(WINTOS_JOURNAL_DIR="$D/journal/days" WINTOS_JOURNAL_TEMPLATE="$D/journal/templates/daily_template.md" nohup wintos/dev-instance.sh >/tmp/wintos-dev.log 2>&1 &)
for _ in $(seq 1 90); do
    curl -s localhost:7731/state 2>/dev/null | grep -q '"day"' && [ "$(curl -s localhost:9224/json/list | grep -c '"page"')" -ge 1 ] && break
    sleep 2
done
sleep 8
node wintos/e2e/seed.mjs
